<?php

namespace Database\Factories;

use App\Models\Offer;
use App\Models\Order;
use App\Models\OrderItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<OrderItem>
 */
class OrderItemFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory(),
            'offer_id' => Offer::factory(),
            // The remaining columns are snapshots of the chosen offer.
            'product_id' => fn (array $attributes) => Offer::findOrFail($attributes['offer_id'])->product_id,
            'product_name' => fn (array $attributes) => Offer::findOrFail($attributes['offer_id'])->product->name,
            'seller_name' => fn (array $attributes) => Offer::findOrFail($attributes['offer_id'])->seller->name,
            'unit_price_cents' => fn (array $attributes) => Offer::findOrFail($attributes['offer_id'])->price_cents,
            'quantity' => 1,
        ];
    }
}
