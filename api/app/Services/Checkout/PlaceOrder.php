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
     * @throws CheckoutInProgress when the buyer's own simultaneous checkouts collided
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

        // A buyer has one checkout in progress at a time, and the database
        // enforces it (the orders_one_pending_per_user index).
        //
        // Asking to check out the cart that is already being checked out
        // is asking for that same checkout, whichever tab or key the
        // request came with: it is answered with the order in progress.
        if ($inProgress = $this->inProgressFor($user, $cartHash)) {
            return $inProgress;
        }

        // A different cart is a new checkout. The buyer went back and
        // changed their mind, so the earlier order is given up first.
        $this->giveUpEarlierOrders($user, $idempotencyKey);

        try {
            return $this->create($user, $items, $cartHash, $idempotencyKey);
        } catch (UniqueConstraintViolationException|CartChanged|OutOfStock $failure) {
            // Another request of this buyer got there first, in the moment
            // between this one looking and this one saving. Its order was
            // committed and its caller has been told so: it is the
            // checkout in progress, and this request must not undo it.
            //
            // If that request was a copy of this one (the same key), or was
            // for the same cart, its order is this request's answer too.
            if ($existing = $this->find($user, $idempotencyKey)) {
                return $this->sameCartOrFail($existing, $cartHash);
            }

            if ($inProgress = $this->inProgressFor($user, $cartHash)) {
                return $inProgress;
            }

            // It was for a different cart. This request held nothing (the
            // order row is the first thing saved, and it was refused), so
            // the buyer is simply told to try again; by then the other
            // order is visible, and trying again is a deliberate choice.
            if ($failure instanceof UniqueConstraintViolationException) {
                throw new CheckoutInProgress;
            }

            // Another buyer took the keys between the quote and the
            // reservation. Everything was rolled back; say what is left.
            throw $failure instanceof OutOfStock ? new CartChanged($this->quotes->quote($items)) : $failure;
        }
    }

    /** The buyer's unpaid order for exactly this cart, if it can still be paid. */
    private function inProgressFor(User $user, string $cartHash): ?Order
    {
        return $user->orders()
            ->where('status', OrderStatus::Pending)
            ->where('cart_hash', $cartHash)
            ->where('expires_at', '>', now())
            ->first();
    }

    /**
     * Cancel the buyer's other unpaid orders, so their keys are free again:
     * without this, a buyer who goes back and changes the cart could be told
     * the last key is taken, by their own abandoned order.
     *
     * An order with this very key is not "an earlier one": it can only have
     * been created, a moment ago, by another copy of this same request, and
     * must be returned to the caller, not cancelled.
     *
     * This runs before anything is saved and only ever cancels orders this
     * request could see when it started. An order committed after that
     * point, by a request running at the same time, is never cancelled here:
     * see the conflict handling in handle().
     *
     * Protected so a test can stand in for "the other order was not there
     * yet when this request looked".
     */
    protected function giveUpEarlierOrders(User $user, string $idempotencyKey): void
    {
        $user->orders()->where('status', OrderStatus::Pending)->where('idempotency_key', '!=', $idempotencyKey)->get()
            ->each(fn (Order $order) => $this->settle->cancel($order));
    }

    /**
     * The order, its lines, its payment record and the held keys, in one
     * transaction.
     *
     * @param  list<array{offer_id: int, quantity: int, unit_price_cents: int|null}>  $items
     */
    private function create(User $user, array $items, string $cartHash, string $idempotencyKey): Order
    {
        return DB::transaction(function () use ($user, $items, $cartHash, $idempotencyKey) {
            $quote = $this->quotes->quote($items);

            if (! $quote['ok']) {
                throw new CartChanged($quote);
            }

            $expiresAt = now()->addMinutes(config('checkout.reservation_minutes'));

            // Created before any key is touched. If the same request is
            // being handled twice at this very moment, or the buyer started
            // another checkout, a unique index makes the second one wait
            // here and then fail, having reserved nothing.
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
