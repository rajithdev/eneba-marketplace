<?php

namespace Database\Factories;

use App\Models\Game;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Product>
 */
class ProductFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        $name = Str::title(fake()->unique()->words(3, true));

        return [
            'name' => $name,
            'slug' => Str::slug($name),
            'game_id' => Game::factory(),
            'platform_id' => Platform::factory(),
            'region_id' => Region::factory(),
            'sales_count' => 0,
        ];
    }

    /**
     * Give the product one sellable offer at this price: an active offer
     * with one available key. The usual starting point for catalog tests.
     */
    public function pricedAt(int $priceCents, int $keys = 1): static
    {
        return $this->afterCreating(function (Product $product) use ($priceCents, $keys) {
            $offer = Offer::factory()->for($product)->create(['price_cents' => $priceCents]);
            LicenseKey::factory()->count($keys)->for($offer)->create();
        });
    }
}
