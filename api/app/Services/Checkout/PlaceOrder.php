<?php

namespace App\Services\Checkout;

use App\Enums\OrderStatus;
use App\Enums\PaymentStatus;
use App\Models\Order;
use App\Models\User;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Step 1 of a purchase: turn a cart into a pending order whose keys are held
 * for the buyer until the order's deadline. No money is involved yet.
 *
 * Everything happens in one database transaction: either the order, its
 * lines, its payment record and the held keys all exist afterwards, or none
 * of them do.
 */
class PlaceOrder
{
    public function __construct(
        private QuoteCart $quotes,
        private InventoryAllocator $inventory,
        private SettleOrder $settle,
    ) {}

    /**
     * @param  list<array{offer_id: int, quantity: int, unit_price_cents: int}>  $items
     * @param  string  $idempotencyKey  chosen by the browser, the same for every
     *                                  repeat of one checkout attempt
     *
     * @throws CartChanged when the cart cannot be bought as the buyer saw it
     * @throws IdempotencyKeyReused when the key was used for a different cart
     */
    public function handle(User $user, array $items, string $idempotencyKey): Order
    {
        $items = $this->quotes->normalise($items);
        $cartHash = $this->quotes->hash($items);

        // A repeat of a request we already handled (double click, retry
        // after a lost response): answer with the order it created.
        if ($existing = $this->find($user, $idempotencyKey)) {
            return $this->sameCartOrFail($existing, $cartHash);
        }

        // A buyer has one checkout in progress at a time. Starting another
        // gives up the earlier ones, so their keys are free again: without
        // this, a buyer who goes back and changes the cart could be told the
        // last key is taken, by their own abandoned order.
        //
        // An order with this very key is not "an earlier one": it can only
        // have been created, a moment ago, by another copy of this same
        // request, and must be returned below, not cancelled.
        $user->orders()->where('status', OrderStatus::Pending)->where('idempotency_key', '!=', $idempotencyKey)->get()
            ->each(fn (Order $order) => $this->settle->cancel($order));

        try {
            return DB::transaction(function () use ($user, $items, $cartHash, $idempotencyKey) {
                $quote = $this->quotes->quote($items);

                if (! $quote['ok']) {
                    throw new CartChanged($quote);
                }

                $expiresAt = now()->addMinutes(config('checkout.reservation_minutes'));

                // Created before any key is touched. If the same request is
                // being handled twice at this very moment, the unique index
                // on (user, idempotency key) makes the second one wait here
                // and then fail, having reserved nothing.
                $order = $user->orders()->create([
                    'public_id' => (string) Str::uuid(),
                    'status' => OrderStatus::Pending,
                    'total_cents' => $quote['totals']['total_cents'],
                    'currency' => $quote['totals']['currency'],
                    'idempotency_key' => $idempotencyKey,
                    'cart_hash' => $cartHash,
                    'expires_at' => $expiresAt,
                ]);

                foreach ($quote['lines'] as $line) {
                    $item = $order->items()->create([
                        'offer_id' => $line['offer_id'],
                        'product_id' => DB::table('offers')->where('id', $line['offer_id'])->value('product_id'),
                        // Copied, so the receipt stays true if the product is
                        // renamed or the price changes later.
                        'product_name' => $line['product']['name'],
                        'seller_name' => $line['seller']['name'],
                        'unit_price_cents' => $line['unit_price']['amount_cents'],
                        'original_unit_price_cents' => $line['unit_price']['original_amount_cents'],
                        'quantity' => $line['quantity'],
                    ]);

                    $this->inventory->reserve($item, $expiresAt);
                }

                $order->payment()->create([
                    'status' => PaymentStatus::Pending,
                    'amount_cents' => $order->total_cents,
                    'currency' => $order->currency,
                ]);

                return $order;
            });
        } catch (UniqueConstraintViolationException|CartChanged|OutOfStock $failure) {
            // The same request may have arrived twice at once. If the other
            // copy created the order, that order is this copy's answer too:
            // whether this copy lost at the unique index, or found the keys
            // already held (by that very order).
            if ($existing = $this->find($user, $idempotencyKey)) {
                return $this->sameCartOrFail($existing, $cartHash);
            }

            // Another buyer took the keys between the quote and the
            // reservation. Everything was rolled back; say what is left.
            throw $failure instanceof OutOfStock ? new CartChanged($this->quotes->quote($items)) : $failure;
        }
    }

    /** Protected so a test can stand in for "the other copy had not saved its order yet". */
    protected function find(User $user, string $idempotencyKey): ?Order
    {
        return $user->orders()->where('idempotency_key', $idempotencyKey)->first();
    }

    private function sameCartOrFail(Order $order, string $cartHash): Order
    {
        if ($order->cart_hash !== $cartHash) {
            throw new IdempotencyKeyReused;
        }

        return $order;
    }
}
