<?php

namespace App\Http\Resources;

use App\Enums\OrderStatus;
use App\Models\Order;
use App\Models\OrderItem;
use App\Support\Price;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An order as it appears in the buyer's order history: what was bought, from
 * whom, for how much, and what became of it. Never includes license keys.
 *
 * Expects the order loaded with its payment and its items' products (with
 * game, platform and region).
 *
 * @mixin Order
 */
class OrderSummaryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $pending = $this->status === OrderStatus::Pending;
        $subtotal = $this->items->sum(fn (OrderItem $item) => max($item->original_unit_price_cents ?? 0, $item->unit_price_cents) * $item->quantity);

        return [
            // The random public id; the numeric database id is never shown.
            'id' => $this->public_id,
            'status' => $this->status->value,
            'created_at' => $this->created_at->toIso8601String(),
            'paid_at' => $this->paid_at?->toIso8601String(),
            // While pending: until when the keys are held. The seconds are
            // counted on the server, so a wrong clock in the browser cannot
            // show the wrong time left.
            'expires_at' => $pending ? $this->expires_at->toIso8601String() : null,
            'expires_in_seconds' => $pending ? max(0, (int) now()->diffInSeconds($this->expires_at, false)) : null,
            // Why the payment was declined, when it was.
            'failure_reason' => $this->failure_reason,
            'totals' => [
                'items_count' => (int) $this->items->sum('quantity'),
                'subtotal_cents' => $subtotal,
                'discount_cents' => $subtotal - $this->total_cents,
                'total_cents' => $this->total_cents,
                'currency' => $this->currency,
            ],
            'payment' => [
                'status' => $this->payment->status->value,
                'method' => $this->payment->method,
            ],
            'items' => $this->items->map(fn (OrderItem $item) => $this->item($item))->all(),
        ];
    }

    /** @return array<string, mixed> */
    protected function item(OrderItem $item): array
    {
        return [
            'offer_id' => $item->offer_id,
            'product' => [
                'slug' => $item->product->slug,
                // The name as it was when the order was placed.
                'name' => $item->product_name,
                'cover_image_url' => $item->product->game->cover_image_url,
                'platform' => ['slug' => $item->product->platform->slug, 'name' => $item->product->platform->name],
                'region' => ['slug' => $item->product->region->slug, 'name' => $item->product->region->name],
            ],
            'seller_name' => $item->seller_name,
            'unit_price' => Price::toArray($item->unit_price_cents, $item->original_unit_price_cents),
            'quantity' => $item->quantity,
            'line_total_cents' => $item->unit_price_cents * $item->quantity,
        ];
    }
}
