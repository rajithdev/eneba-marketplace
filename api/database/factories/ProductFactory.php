<?php

namespace Database\Factories;

use App\Enums\ProductType;
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
            'description' => fake()->paragraph(),
            'cover_image_url' => null,
            'platform_id' => Platform::factory(),
            'region_id' => Region::factory(),
            'type' => ProductType::Game,
            'release_date' => fake()->date(),
            'sales_count' => 0,
        ];
    }
}
