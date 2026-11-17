<?php

namespace Tests\Feature\Catalog;

use App\Models\Game;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use App\Models\Seller;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** GET /api/products/{slug}: one product, its sellers' offers, and the game's other variants. */
class ProductDetailTest extends TestCase
{
    use RefreshDatabase;

    private function offer(Product $product, string $seller, int $price, int $availableKeys = 1, array $attributes = []): Offer
    {
        $offer = Offer::factory()
            ->for($product)
            ->for(Seller::factory()->create(['name' => $seller, 'slug' => str($seller)->slug()]))
            ->create(['price_cents' => $price, ...$attributes]);
        LicenseKey::factory()->count($availableKeys)->for($offer)->create();

        return $offer;
    }

    public function test_it_returns_the_product_with_its_game_details(): void
    {
        $game = Game::factory()->create([
            'slug' => 'elden-ring',
            'title' => 'Elden Ring',
            'description' => 'An open-world action RPG.',
            'cover_image_url' => '/covers/elden-ring.svg',
            'release_date' => '2022-02-25',
        ]);
        $product = Product::factory()->for($game)
            ->for(Platform::factory()->create(['slug' => 'steam', 'name' => 'Steam']))
            ->for(Region::factory()->create(['slug' => 'global', 'name' => 'Global']))
            ->create(['slug' => 'elden-ring-steam-key-global', 'name' => 'Elden Ring Steam Key GLOBAL']);
        $offer = $this->offer($product, 'Brightkey Games', 3299, attributes: ['original_price_cents' => 4399]);

        $this->getJson('/api/products/elden-ring-steam-key-global')->assertOk()->assertExactJson([
            'data' => [
                'slug' => 'elden-ring-steam-key-global',
                'name' => 'Elden Ring Steam Key GLOBAL',
                'type' => 'game',
                'cover_image_url' => '/covers/elden-ring.svg',
                'release_date' => '2022-02-25',
                'platform' => ['slug' => 'steam', 'name' => 'Steam'],
                'region' => ['slug' => 'global', 'name' => 'Global'],
                'in_stock' => true,
                'price' => ['amount_cents' => 3299, 'currency' => 'EUR', 'original_amount_cents' => 4399, 'discount_percent' => 25],
                'offers_count' => 1,
                'game' => ['slug' => 'elden-ring', 'title' => 'Elden Ring', 'description' => 'An open-world action RPG.'],
                'offers' => [[
                    'id' => $offer->id,
                    'seller' => [
                        'slug' => 'brightkey-games',
                        'name' => 'Brightkey Games',
                        'rating_percent' => (float) $offer->seller->rating_percent,
                        'sales_count' => $offer->seller->sales_count,
                    ],
                    'price' => ['amount_cents' => 3299, 'currency' => 'EUR', 'original_amount_cents' => 4399, 'discount_percent' => 25],
                    'in_stock' => true,
                ]],
                'variants' => [],
            ],
        ]);
    }

    public function test_offers_are_listed_purchasable_first_then_cheapest_first(): void
    {
        $product = Product::factory()->create(['slug' => 'the-product']);

        $this->offer($product, 'Dear but in stock', 2000);
        $this->offer($product, 'Cheapest but sold out', 500, availableKeys: 0);
        $this->offer($product, 'Best deal', 1200);
        $this->offer($product, 'Switched off', 100, attributes: ['is_active' => false]);
        $this->offer($product, 'Also sold out', 900, availableKeys: 0);

        $offers = $this->getJson('/api/products/the-product')->assertOk()->json('data.offers');

        $this->assertSame(
            [
                ['Best deal', true],
                ['Dear but in stock', true],
                ['Cheapest but sold out', false],
                ['Also sold out', false],
            ],
            array_map(fn (array $offer) => [$offer['seller']['name'], $offer['in_stock']], $offers),
        );
        // The headline price is the first purchasable offer's, not the lowest number on the page.
        $this->getJson('/api/products/the-product')
            ->assertJsonPath('data.price.amount_cents', 1200)
            ->assertJsonPath('data.offers_count', 2);
    }

    public function test_a_sold_out_product_still_has_a_page_showing_its_offers_as_unavailable(): void
    {
        $product = Product::factory()->create(['slug' => 'sold-out']);
        $this->offer($product, 'Seller', 1500, availableKeys: 0);

        $this->getJson('/api/products/sold-out')->assertOk()
            ->assertJsonPath('data.in_stock', false)
            ->assertJsonPath('data.price', null)
            ->assertJsonPath('data.offers.0.in_stock', false)
            ->assertJsonPath('data.offers.0.price.amount_cents', 1500);
    }

    public function test_it_lists_the_other_variants_of_the_same_game_with_their_prices(): void
    {
        $game = Game::factory()->create();
        $current = Product::factory()->for($game)->pricedAt(3000)->create(['slug' => 'current', 'name' => 'Current']);
        Product::factory()->for($game)->pricedAt(3500)->create(['name' => 'Dearer variant']);
        Product::factory()->for($game)->pricedAt(2800)->create(['name' => 'Cheaper variant']);
        Product::factory()->for($game)->create(['name' => 'Sold-out variant']);
        Product::factory()->pricedAt(100)->create(['name' => 'Another game entirely']);

        $variants = $this->getJson('/api/products/current')->assertOk()->json('data.variants');

        $this->assertSame(
            [['Cheaper variant', 2800], ['Dearer variant', 3500], ['Sold-out variant', null]],
            array_map(fn (array $variant) => [$variant['name'], $variant['price']['amount_cents'] ?? null], $variants),
        );
        // A variant is a full product summary, so the page can link straight to it.
        $this->assertSame(
            ['slug', 'name', 'type', 'cover_image_url', 'release_date', 'platform', 'region', 'in_stock', 'price', 'offers_count'],
            array_keys($variants[0]),
        );
    }

    public function test_an_unknown_product_is_a_json_404_that_reveals_nothing_about_the_code(): void
    {
        // As in production. (With debug on, Laravel adds a stack trace to errors.)
        config(['app.debug' => false]);

        $this->getJson('/api/products/does-not-exist')
            ->assertNotFound()
            ->assertExactJson(['message' => 'Product not found.']);
    }

    public function test_license_key_codes_never_appear_on_the_product_page(): void
    {
        $product = Product::factory()->create(['slug' => 'the-product']);
        $offer = $this->offer($product, 'Seller', 1000, availableKeys: 0);
        LicenseKey::factory()->for($offer)->create(['code' => 'SECRET-KEY01-ABCDE']);

        $body = $this->getJson('/api/products/the-product')->assertOk()->getContent();

        $this->assertStringNotContainsString('SECRET-KEY01-ABCDE', $body);
        $this->assertStringNotContainsString('"code"', $body);
    }

    public function test_the_number_of_database_queries_does_not_grow_with_offers_or_variants(): void
    {
        $countQueries = function (string $slug): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson("/api/products/{$slug}")->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };

        // Both have offers and other variants; only the amounts differ.
        $smallGame = Game::factory()->create();
        $small = Product::factory()->for($smallGame)->create(['slug' => 'small']);
        $this->offer($small, 'Only seller', 1000);
        Product::factory()->for($smallGame)->pricedAt(2000)->create();

        $game = Game::factory()->create();
        $large = Product::factory()->for($game)->create(['slug' => 'large']);
        foreach (range(1, 8) as $i) {
            $this->offer($large, "Seller {$i}", 1000 + $i);
        }
        Product::factory()->count(6)->for($game)->pricedAt(2000)->create();

        $this->assertSame($countQueries('small'), $countQueries('large'));
        // The check for overdue reservations, then: product, its
        // game/platform/region, offers, sellers, variants, and the variants'
        // game/platform/region.
        $this->assertSame(11, $countQueries('large'));
    }
}
