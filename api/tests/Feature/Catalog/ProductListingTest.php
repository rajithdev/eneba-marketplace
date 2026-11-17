<?php

namespace Tests\Feature\Catalog;

use App\Enums\GameType;
use App\Models\Game;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\OrderItem;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * GET /api/products, against real PostgreSQL: pricing, stock, filters,
 * sorting, pagination and validation.
 */
class ProductListingTest extends TestCase
{
    use RefreshDatabase;

    /** An offer with the given number of keys a buyer can still get. */
    private function offer(Product $product, int $price, int $availableKeys = 1, array $attributes = []): Offer
    {
        $offer = Offer::factory()->for($product)->create(['price_cents' => $price, ...$attributes]);
        LicenseKey::factory()->count($availableKeys)->for($offer)->create();

        return $offer;
    }

    /** @return list<string> product names, in the order the API returned them */
    private function names(string $query = ''): array
    {
        return $this->getJson("/api/products{$query}")->assertOk()->json('data.*.name');
    }

    // ------------------------------------------------------------- pricing ---

    public function test_the_listed_price_is_the_cheapest_offer_that_can_actually_be_bought(): void
    {
        $product = Product::factory()->create();

        $this->offer($product, 500, availableKeys: 0);                       // cheapest, but out of keys
        $this->offer($product, 600, attributes: ['is_active' => false]);     // switched off by the seller
        $onlySold = $this->offer($product, 650, availableKeys: 0);
        $onlyReserved = $this->offer($product, 660, availableKeys: 0);
        LicenseKey::factory()->soldTo(OrderItem::factory()->for($onlySold)->create())->create();
        LicenseKey::factory()->reservedFor(OrderItem::factory()->for($onlyReserved)->create())->create();
        $this->offer($product, 700);                                          // the real best price
        $this->offer($product, 900, availableKeys: 3);

        $this->getJson('/api/products')->assertOk()
            ->assertJsonPath('data.0.price.amount_cents', 700)
            ->assertJsonPath('data.0.in_stock', true)
            ->assertJsonPath('data.0.offers_count', 2);
    }

    public function test_a_discount_is_reported_with_the_original_price_and_a_percentage(): void
    {
        $this->offer(Product::factory()->create(['name' => 'Discounted']), 1500, attributes: ['original_price_cents' => 2000]);
        $this->offer(Product::factory()->create(['name' => 'Full price']), 1800);

        $byName = collect($this->getJson('/api/products')->json('data'))->keyBy('name');

        $this->assertSame(
            ['amount_cents' => 1500, 'currency' => 'EUR', 'original_amount_cents' => 2000, 'discount_percent' => 25],
            $byName['Discounted']['price'],
        );
        $this->assertSame(
            ['amount_cents' => 1800, 'currency' => 'EUR', 'original_amount_cents' => null, 'discount_percent' => null],
            $byName['Full price']['price'],
        );
    }

    public function test_the_discount_shown_belongs_to_the_cheapest_offer_not_to_a_pricier_one(): void
    {
        $product = Product::factory()->create();
        $this->offer($product, 1000);                                              // best price, no discount
        $this->offer($product, 1200, attributes: ['original_price_cents' => 3000]); // big discount, but dearer

        $this->getJson('/api/products')
            ->assertJsonPath('data.0.price.amount_cents', 1000)
            ->assertJsonPath('data.0.price.discount_percent', null);
    }

    public function test_a_product_whose_sellers_are_all_out_of_keys_is_sold_out_with_no_price(): void
    {
        $this->offer(Product::factory()->create(['name' => 'Offers but no keys']), 1000, availableKeys: 0);
        Product::factory()->create(['name' => 'No offers at all']);

        foreach ($this->getJson('/api/products')->assertOk()->json('data') as $product) {
            $this->assertFalse($product['in_stock'], $product['name']);
            $this->assertNull($product['price'], $product['name']);
            $this->assertSame(0, $product['offers_count'], $product['name']);
        }
    }

    // ------------------------------------------------------------- sorting ---

    public function test_products_are_sorted_by_popularity_by_default(): void
    {
        Product::factory()->pricedAt(1000)->create(['name' => 'Niche', 'sales_count' => 10]);
        Product::factory()->pricedAt(1000)->create(['name' => 'Hit', 'sales_count' => 900]);
        Product::factory()->pricedAt(1000)->create(['name' => 'Steady', 'sales_count' => 300]);

        $this->assertSame(['Hit', 'Steady', 'Niche'], $this->names());
        $this->assertSame(['Hit', 'Steady', 'Niche'], $this->names('?sort=popular'));
    }

    public function test_products_can_be_sorted_by_price_in_both_directions(): void
    {
        Product::factory()->pricedAt(2500)->create(['name' => 'Mid']);
        Product::factory()->pricedAt(900)->create(['name' => 'Cheap']);
        Product::factory()->pricedAt(5900)->create(['name' => 'Dear']);

        $this->assertSame(['Cheap', 'Mid', 'Dear'], $this->names('?sort=price_asc'));
        $this->assertSame(['Dear', 'Mid', 'Cheap'], $this->names('?sort=price_desc'));
    }

    public function test_newest_sorts_by_the_games_release_date_with_undated_titles_last(): void
    {
        $game = fn (?string $date) => Game::factory()->create(['release_date' => $date]);

        Product::factory()->pricedAt(1000)->for($game('2015-05-19'))->create(['name' => 'Old']);
        Product::factory()->pricedAt(1000)->for($game(null))->create(['name' => 'Gift card, no date']);
        Product::factory()->pricedAt(1000)->for($game('2024-09-27'))->create(['name' => 'New']);

        $this->assertSame(['New', 'Old', 'Gift card, no date'], $this->names('?sort=newest'));
    }

    public function test_sold_out_products_come_after_available_ones_in_every_sort_order(): void
    {
        $recent = Game::factory()->create(['release_date' => '2026-01-01']);
        $older = Game::factory()->create(['release_date' => '2010-01-01']);

        // The sold-out product would win every ordering if stock were ignored:
        // most popular, newest, and (with no price) first when sorting NULLs.
        Product::factory()->for($recent)->create(['name' => 'Sold out', 'sales_count' => 99_999]);
        Product::factory()->for($older)->pricedAt(1000)->create(['name' => 'Available A', 'sales_count' => 5]);
        Product::factory()->for($older)->pricedAt(2000)->create(['name' => 'Available B', 'sales_count' => 4]);

        foreach (['popular', 'price_asc', 'price_desc', 'newest'] as $sort) {
            $names = $this->names("?sort={$sort}");

            $this->assertSame('Sold out', $names[2], "sold-out product must be last when sorting by {$sort}");
            $this->assertEqualsCanonicalizing(['Available A', 'Available B'], array_slice($names, 0, 2));
        }
    }

    public function test_products_with_equal_sort_values_keep_a_stable_order_across_pages(): void
    {
        Product::factory()->count(7)->pricedAt(1000)->create(['sales_count' => 50]);

        $seen = [];
        foreach ([1, 2, 3, 4] as $page) {
            $seen = [...$seen, ...$this->getJson("/api/products?sort=price_asc&per_page=2&page={$page}")->json('data.*.slug')];
        }

        $this->assertCount(7, $seen);
        $this->assertCount(7, array_unique($seen), 'a product appeared on two pages');
    }

    // ------------------------------------------------------------- filters ---

    public function test_products_can_be_filtered_by_platform_region_and_type(): void
    {
        $steam = Platform::factory()->create(['slug' => 'steam']);
        $xbox = Platform::factory()->create(['slug' => 'xbox-live']);
        $psn = Platform::factory()->create(['slug' => 'psn']);
        $global = Region::factory()->create(['slug' => 'global']);
        $europe = Region::factory()->create(['slug' => 'europe']);
        $game = Game::factory()->create(['type' => GameType::Game]);
        $dlc = Game::factory()->create(['type' => GameType::Dlc]);

        $make = fn (string $name, $game, $platform, $region) => Product::factory()
            ->pricedAt(1000)->for($game)->for($platform)->for($region)->create(['name' => $name]);

        $make('Steam Global game', $game, $steam, $global);
        $make('Steam Europe DLC', $dlc, $steam, $europe);
        $make('Xbox Europe game', $game, $xbox, $europe);
        $make('PSN Global DLC', $dlc, $psn, $global);

        $this->assertEqualsCanonicalizing(['Steam Global game', 'Steam Europe DLC'], $this->names('?platform=steam'));
        $this->assertEqualsCanonicalizing(['Steam Europe DLC', 'Xbox Europe game'], $this->names('?region=europe'));
        $this->assertEqualsCanonicalizing(['Steam Europe DLC', 'PSN Global DLC'], $this->names('?type=dlc'));

        // Several values of one filter widen it (steam OR xbox)...
        $this->assertEqualsCanonicalizing(
            ['Steam Global game', 'Steam Europe DLC', 'Xbox Europe game'],
            $this->names('?platform=steam,xbox-live'),
        );
        // ...different filters narrow it (steam AND europe AND dlc).
        $this->assertSame(['Steam Europe DLC'], $this->names('?platform=steam&region=europe&type=dlc'));
        $this->assertSame([], $this->names('?platform=psn&region=europe'));
    }

    public function test_the_price_range_is_inclusive_and_uses_the_best_in_stock_price(): void
    {
        Product::factory()->pricedAt(999)->create(['name' => '9.99']);
        Product::factory()->pricedAt(1000)->create(['name' => '10.00']);
        Product::factory()->pricedAt(2000)->create(['name' => '20.00']);
        Product::factory()->pricedAt(2001)->create(['name' => '20.01']);

        // Its cheapest offer (5.00) has no keys, so its real price is 15.00.
        $tricky = Product::factory()->create(['name' => 'Cheap offer sold out']);
        $this->offer($tricky, 500, availableKeys: 0);
        $this->offer($tricky, 1500);

        $this->assertEqualsCanonicalizing(
            ['10.00', '20.00', 'Cheap offer sold out'],
            $this->names('?min_price=1000&max_price=2000'),
        );
        $this->assertEqualsCanonicalizing(['9.99'], $this->names('?max_price=999'));
        $this->assertEqualsCanonicalizing(['20.01'], $this->names('?min_price=2001'));
    }

    public function test_a_price_filter_leaves_out_sold_out_products_because_they_have_no_price(): void
    {
        Product::factory()->pricedAt(1000)->create(['name' => 'In stock']);
        Product::factory()->create(['name' => 'Sold out']);

        $this->assertSame(['In stock', 'Sold out'], $this->names());
        $this->assertSame(['In stock'], $this->names('?min_price=0'));
    }

    // ---------------------------------------------------------- pagination ---

    public function test_results_are_paginated_and_report_the_totals(): void
    {
        Product::factory()->count(5)->pricedAt(1000)->create();

        $first = $this->getJson('/api/products?per_page=2')->assertOk();
        $first->assertJsonCount(2, 'data')
            ->assertExactJson([
                'data' => $first->json('data'),
                'meta' => ['current_page' => 1, 'per_page' => 2, 'total' => 5, 'last_page' => 3],
            ]);

        $this->getJson('/api/products?per_page=2&page=3')->assertJsonCount(1, 'data')->assertJsonPath('meta.current_page', 3);
        $this->getJson('/api/products')->assertJsonPath('meta.per_page', 24);
    }

    public function test_a_page_past_the_end_is_an_empty_list_not_an_error(): void
    {
        Product::factory()->count(2)->pricedAt(1000)->create();

        $this->getJson('/api/products?page=9')->assertOk()
            ->assertJsonCount(0, 'data')
            ->assertJsonPath('meta.total', 2)
            ->assertJsonPath('meta.last_page', 1);
    }

    // ---------------------------------------------------------- validation ---

    public function test_invalid_input_is_rejected_with_a_message_per_field(): void
    {
        Platform::factory()->create(['slug' => 'steam']);

        $invalid = [
            'platform=dreamcast' => 'platform.0',
            'platform=steam,dreamcast' => 'platform.1',
            'region=atlantis' => 'region.0',
            'type=console' => 'type.0',
            'sort=cheapest' => 'sort',
            'min_price=-1' => 'min_price',
            'min_price=ten' => 'min_price',
            'min_price=500&max_price=100' => 'max_price',
            'page=0' => 'page',
            'page=two' => 'page',
            'per_page=0' => 'per_page',
            'per_page=49' => 'per_page',
        ];

        foreach ($invalid as $query => $field) {
            $this->getJson("/api/products?{$query}")
                ->assertUnprocessable()
                ->assertJsonValidationErrors($field);
        }
    }

    public function test_an_empty_filter_value_means_no_filter(): void
    {
        Product::factory()->count(2)->pricedAt(1000)->create();

        $this->getJson('/api/products?platform=&region=&type=&min_price=&max_price=&sort=&page=&per_page=')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('meta.per_page', 24);
    }

    // ------------------------------------------------- shape, safety, cost ---

    public function test_each_product_has_exactly_the_documented_fields(): void
    {
        $game = Game::factory()->create(['cover_image_url' => '/covers/elden-ring.svg', 'release_date' => '2022-02-25']);
        $steam = Platform::factory()->create(['slug' => 'steam', 'name' => 'Steam']);
        $global = Region::factory()->create(['slug' => 'global', 'name' => 'Global']);
        Product::factory()->pricedAt(3499)->for($game)->for($steam)->for($global)
            ->create(['slug' => 'elden-ring-steam-key-global', 'name' => 'Elden Ring Steam Key GLOBAL']);

        $this->getJson('/api/products')->assertExactJson([
            'data' => [[
                'slug' => 'elden-ring-steam-key-global',
                'name' => 'Elden Ring Steam Key GLOBAL',
                'type' => 'game',
                'cover_image_url' => '/covers/elden-ring.svg',
                'release_date' => '2022-02-25',
                'platform' => ['slug' => 'steam', 'name' => 'Steam'],
                'region' => ['slug' => 'global', 'name' => 'Global'],
                'in_stock' => true,
                'price' => ['amount_cents' => 3499, 'currency' => 'EUR', 'original_amount_cents' => null, 'discount_percent' => null],
                'offers_count' => 1,
            ]],
            'meta' => ['current_page' => 1, 'per_page' => 24, 'total' => 1, 'last_page' => 1],
        ]);
    }

    public function test_variants_of_one_game_share_its_cover_and_release_date(): void
    {
        $game = Game::factory()->create(['cover_image_url' => '/covers/shared.svg', 'release_date' => '2020-12-10']);
        Product::factory()->count(3)->pricedAt(1000)->for($game)->create();

        $products = $this->getJson('/api/products')->json('data');

        $this->assertSame(['/covers/shared.svg'], array_values(array_unique(array_column($products, 'cover_image_url'))));
        $this->assertSame(['2020-12-10'], array_values(array_unique(array_column($products, 'release_date'))));
    }

    public function test_license_key_codes_never_appear_in_the_list(): void
    {
        $offer = $this->offer(Product::factory()->create(), 1000, availableKeys: 0);
        LicenseKey::factory()->for($offer)->create(['code' => 'SECRET-KEY01-ABCDE']);

        $body = $this->getJson('/api/products')->assertOk()->getContent();

        $this->assertStringNotContainsString('SECRET-KEY01-ABCDE', $body);
        $this->assertStringNotContainsString('"code"', $body);
    }

    public function test_the_number_of_database_queries_does_not_grow_with_the_number_of_products(): void
    {
        $countQueries = function (): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson('/api/products?per_page=48')->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };

        Product::factory()->count(2)->pricedAt(1000)->create();
        $withTwo = $countQueries();

        Product::factory()->count(30)->pricedAt(1000)->create();
        $withThirtyTwo = $countQueries();

        $this->assertSame($withTwo, $withThirtyTwo, 'the list must not run extra queries per product');
        // The check for overdue reservations, one to count, one for the page,
        // one each for games, platforms, regions.
        $this->assertSame(6, $withThirtyTwo);
    }
}
