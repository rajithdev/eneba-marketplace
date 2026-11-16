<?php

namespace Tests\Feature\Catalog;

use App\Enums\GameType;
use App\Models\Game;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** GET /api/filters: what the store's filter panel and sort menu are built from. */
class CatalogFiltersTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_lists_platforms_regions_and_types_with_how_many_products_each_has(): void
    {
        $steam = Platform::factory()->create(['slug' => 'steam', 'name' => 'Steam']);
        $xbox = Platform::factory()->create(['slug' => 'xbox-live', 'name' => 'Xbox Live']);
        $europe = Region::factory()->create(['slug' => 'europe', 'name' => 'Europe']);
        $global = Region::factory()->create(['slug' => 'global', 'name' => 'Global']);
        $game = Game::factory()->create(['type' => GameType::Game]);
        $dlc = Game::factory()->create(['type' => GameType::Dlc]);

        Product::factory()->for($game)->for($steam)->for($global)->create();
        Product::factory()->for($game)->for($steam)->for($europe)->create();
        Product::factory()->for($dlc)->for($xbox)->for($europe)->create();

        $this->getJson('/api/filters')->assertOk()
            ->assertJsonPath('data.platforms', [
                ['slug' => 'steam', 'name' => 'Steam', 'products_count' => 2],
                ['slug' => 'xbox-live', 'name' => 'Xbox Live', 'products_count' => 1],
            ])
            ->assertJsonPath('data.regions', [
                ['slug' => 'europe', 'name' => 'Europe', 'products_count' => 2],
                ['slug' => 'global', 'name' => 'Global', 'products_count' => 1],
            ])
            ->assertJsonPath('data.types', [
                ['value' => 'game', 'label' => 'Games', 'products_count' => 2],
                ['value' => 'dlc', 'label' => 'DLC', 'products_count' => 1],
                ['value' => 'gift_card', 'label' => 'Gift cards', 'products_count' => 0],
                ['value' => 'subscription', 'label' => 'Subscriptions', 'products_count' => 0],
            ]);
    }

    public function test_the_price_range_spans_what_a_buyer_can_pay_right_now(): void
    {
        Product::factory()->pricedAt(1200)->create();
        Product::factory()->pricedAt(5400)->create();

        // Neither of these should stretch the range: a sold-out offer at 1.00,
        // and a product with nothing in stock at all.
        $withCheapSoldOutOffer = Product::factory()->pricedAt(3000)->create();
        Offer::factory()->for($withCheapSoldOutOffer)->create(['price_cents' => 100]);
        Offer::factory()->for(Product::factory()->create())->create(['price_cents' => 99_900]);

        $this->getJson('/api/filters')->assertOk()
            ->assertJsonPath('data.price', ['min_cents' => 1200, 'max_cents' => 5400, 'currency' => 'EUR']);
    }

    public function test_it_lists_the_sort_orders_and_page_sizes_the_list_accepts(): void
    {
        $this->getJson('/api/filters')->assertOk()
            ->assertJsonPath('data.sorts', [
                ['value' => 'popular', 'label' => 'Most popular'],
                ['value' => 'price_asc', 'label' => 'Price: low to high'],
                ['value' => 'price_desc', 'label' => 'Price: high to low'],
                ['value' => 'newest', 'label' => 'Newest releases'],
            ])
            ->assertJsonPath('data.default_sort', 'popular')
            // "Best match" exists only while searching, so it is listed apart.
            ->assertJsonPath('data.search', [
                'sort' => ['value' => 'relevance', 'label' => 'Best match'],
                'max_length' => 80,
                'suggestions_min_length' => 2,
            ])
            ->assertJsonPath('data.per_page', ['default' => 24, 'max' => 48]);
    }

    public function test_every_listed_option_is_accepted_by_the_product_list(): void
    {
        $product = Product::factory()->pricedAt(1000)->create();
        LicenseKey::factory()->for($product->offers->first())->create();
        $filters = $this->getJson('/api/filters')->json('data');

        foreach (array_column($filters['platforms'], 'slug') as $slug) {
            $this->getJson("/api/products?platform={$slug}")->assertOk();
        }
        foreach (array_column($filters['regions'], 'slug') as $slug) {
            $this->getJson("/api/products?region={$slug}")->assertOk();
        }
        foreach (array_column($filters['types'], 'value') as $type) {
            $this->getJson("/api/products?type={$type}")->assertOk();
        }
        foreach (array_column($filters['sorts'], 'value') as $sort) {
            $this->getJson("/api/products?sort={$sort}")->assertOk();
        }
        $this->getJson('/api/products?per_page='.$filters['per_page']['max'])->assertOk();
    }

    public function test_an_empty_catalog_has_no_price_range(): void
    {
        $this->getJson('/api/filters')->assertOk()
            ->assertJsonPath('data.platforms', [])
            ->assertJsonPath('data.price', ['min_cents' => null, 'max_cents' => null, 'currency' => 'EUR']);
    }
}
