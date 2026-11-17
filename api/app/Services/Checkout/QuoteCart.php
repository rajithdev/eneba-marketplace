<?php

namespace App\Services\Checkout;

use App\Enums\LicenseKeyStatus;
use App\Enums\OrderStatus;
use App\Models\Offer;
use App\Models\OrderItem;
use App\Models\User;
use App\Support\Price;

/**
 * Prices a cart from the database. The browser only says which offers and
 * how many; names, sellers, prices and how many can be bought all come from
 * here, both when the cart page checks itself and when an order is placed.
 *
 * A cart item is a seller's offer, not a product: the buyer chose that
 * seller at that price.
 */
class QuoteCart
{
    /**
     * One entry per offer, in a fixed order: the same offer listed twice
     * becomes one line with the quantities added.
     *
     * @param  list<array{offer_id: int, quantity: int, unit_price_cents?: int|null}>  $items
     * @return list<array{offer_id: int, quantity: int, unit_price_cents: int|null}>
     */
    public function normalise(array $items): array
    {
        $byOffer = [];

        foreach ($items as $item) {
            $offerId = (int) $item['offer_id'];
            $byOffer[$offerId] ??= ['offer_id' => $offerId, 'quantity' => 0, 'unit_price_cents' => null];
            $byOffer[$offerId]['quantity'] += (int) $item['quantity'];
            // The price the buyer was last shown, if the browser sent one.
            $byOffer[$offerId]['unit_price_cents'] ??= isset($item['unit_price_cents']) ? (int) $item['unit_price_cents'] : null;
        }

        ksort($byOffer);

        return array_values($byOffer);
    }

    /**
     * Identifies a cart: the same offers, quantities and expected prices
     * always give the same value.
     *
     * @param  list<array{offer_id: int, quantity: int, unit_price_cents: int|null}>  $normalisedItems
     */
    public function hash(array $normalisedItems): string
    {
        return hash('sha256', json_encode($normalisedItems));
    }

    /**
     * The cart as it can be bought right now.
     *
     * Each line reports what is wrong with it, if anything:
     *   unavailable         the offer is gone, switched off or sold out
     *   insufficient_stock  fewer keys are left than were asked for
     *   quantity_limited    more were asked for than one order may hold
     *   price_changed       the price is not the one the buyer was shown
     *
     * `quantity` is what can actually be bought (never more than is in
     * stock) and the totals count exactly that, so a browser that adopts
     * the returned lines has a cart with no issues left.
     *
     * Keys that the buyer's own unpaid order is holding count as in stock
     * for that buyer: placing a new order gives the earlier one up first
     * (see PlaceOrder), so they really are theirs to buy. Without this, a
     * buyer who starts the checkout and returns to the cart would be told
     * the last key is gone, taken by themselves.
     *
     * @param  list<array{offer_id: int, quantity: int, unit_price_cents?: int|null}>  $items
     * @param  User|null  $buyer  the signed-in buyer, if there is one
     * @return array{lines: list<array<string, mixed>>, totals: array<string, mixed>, ok: bool}
     */
    public function quote(array $items, ?User $buyer = null): array
    {
        $items = $this->normalise($items);

        $heldByBuyer = $buyer === null ? null : OrderItem::query()->select('order_items.id')
            ->join('orders', 'orders.id', '=', 'order_items.order_id')
            ->where('orders.user_id', $buyer->id)
            ->where('orders.status', OrderStatus::Pending);

        $offers = Offer::query()
            ->whereIn('id', array_column($items, 'offer_id'))
            ->with(['seller', 'product.game', 'product.platform', 'product.region'])
            ->withCount(['licenseKeys as stock' => fn ($keys) => $keys->where(fn ($key) => $key
                ->where('status', LicenseKeyStatus::Available)
                ->when($heldByBuyer, fn ($key) => $key->orWhere(fn ($held) => $held
                    ->where('status', LicenseKeyStatus::Reserved)
                    ->whereIn('order_item_id', $heldByBuyer))),
            )])
            ->get()
            ->keyBy('id');

        $lines = [];
        $subtotal = $total = $count = 0;
        $ok = $items !== [];

        foreach ($items as $item) {
            $offer = $offers->get($item['offer_id']);
            // How many of this offer one cart may hold right now: what is in
            // stock, up to the limit per line. The exact stock is not
            // revealed beyond that limit.
            $stock = $offer?->is_active ? $offer->stock : 0;
            $buyable = min($stock, config('checkout.max_quantity'));
            $quantity = min($item['quantity'], $buyable);

            $issues = [];
            if ($buyable === 0) {
                $issues[] = 'unavailable';
            } else {
                if ($quantity < $item['quantity']) {
                    // Which of the two held the buyer back.
                    $issues[] = $buyable === $stock ? 'insufficient_stock' : 'quantity_limited';
                }
                if ($item['unit_price_cents'] !== null && $item['unit_price_cents'] !== $offer->price_cents) {
                    $issues[] = 'price_changed';
                }
            }

            $lines[] = [
                'offer_id' => $item['offer_id'],
                'requested_quantity' => $item['quantity'],
                'quantity' => $quantity,
                'max_quantity' => $buyable,
                'product' => $offer === null ? null : [
                    'slug' => $offer->product->slug,
                    'name' => $offer->product->name,
                    'cover_image_url' => $offer->product->game->cover_image_url,
                    'platform' => ['slug' => $offer->product->platform->slug, 'name' => $offer->product->platform->name],
                    'region' => ['slug' => $offer->product->region->slug, 'name' => $offer->product->region->name],
                ],
                'seller' => $offer === null ? null : [
                    'slug' => $offer->seller->slug,
                    'name' => $offer->seller->name,
                    'rating_percent' => (float) $offer->seller->rating_percent,
                    'sales_count' => $offer->seller->sales_count,
                ],
                'unit_price' => $offer === null ? null : Price::toArray($offer->price_cents, $offer->original_price_cents),
                'line_total_cents' => $offer === null ? 0 : $offer->price_cents * $quantity,
                'issues' => $issues,
            ];

            if ($offer !== null) {
                $subtotal += max($offer->original_price_cents ?? 0, $offer->price_cents) * $quantity;
                $total += $offer->price_cents * $quantity;
                $count += $quantity;
            }

            $ok = $ok && $issues === [];
        }

        return [
            'lines' => $lines,
            'totals' => [
                'items_count' => $count,
                // Before discounts, the discounts, and what is actually paid.
                'subtotal_cents' => $subtotal,
                'discount_cents' => $subtotal - $total,
                'total_cents' => $total,
                'currency' => Price::CURRENCY,
            ],
            // True when the cart can be bought exactly as it was sent.
            'ok' => $ok,
        ];
    }
}
