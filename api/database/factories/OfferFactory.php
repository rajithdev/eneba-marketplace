<?php

namespace Database\Factories;

use App\Models\Offer;
use App\Models\Product;
use App\Models\Seller;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Offer>
 */
class OfferFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'product_id' => Product::factory(),
            'seller_id' => Seller::factory(),
            'price_cents' => fake()->numberBetween(500, 6000),
            'original_price_cents' => null,
            'currency' => 'EUR',
            'is_active' => true,
        ];
    }

    /**
     * An offer shown with a struck-through "was" price.
     *
     * The original price is derived from the price known at this point, so set
     * a specific price with ->state() before calling this, not in create().
     */
    public function discounted(int $percent = 25): static
    {
        return $this->state(fn (array $attributes) => [
            'original_price_cents' => (int) round($attributes['price_cents'] * 100 / (100 - $percent)),
        ]);
    }
}
