<?php

namespace Tests\Feature\Catalog;

use App\Enums\LicenseKeyStatus;
use App\Models\Game;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\OrderItem;
use App\Models\Product;
use Database\Seeders\CatalogSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/** The curated catalog: complete, the same every time, and safe to load again. */
class CatalogSeederTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<int, array<string, mixed>> */
    private function gamesFile(): array
    {
        return json_decode(file_get_contents(database_path('data/games.json')), true);
    }

    /**
     * One fingerprint of everything the seeder produces that a buyer could
     * notice: names, prices, discounts and every key. Row ids and timestamps
     * are left out; they are not part of the data.
     */
    private function fingerprint(): string
    {
        $rows = [
            DB::table('games')->orderBy('slug')->get(['slug', 'title', 'description', 'type', 'release_date', 'cover_image_url']),
            DB::table('products')->orderBy('slug')->get(['slug', 'name', 'sales_count']),
            DB::table('sellers')->orderBy('slug')->get(['slug', 'name', 'rating_percent', 'sales_count']),
            DB::table('offers')
                ->join('products', 'products.id', '=', 'offers.product_id')
                ->join('sellers', 'sellers.id', '=', 'offers.seller_id')
                ->orderBy('products.slug')->orderBy('sellers.slug')
                ->get(['products.slug as product', 'sellers.slug as seller', 'price_cents', 'original_price_cents', 'is_active']),
            DB::table('license_keys')->orderBy('code')->get(['code', 'status']),
        ];

        return hash('sha256', json_encode($rows));
    }

    public function test_it_loads_every_game_and_variant_from_the_data_files(): void
    {
        $this->seed(CatalogSeeder::class);
        $games = $this->gamesFile();

        $this->assertSame(count($games), Game::count());
        $this->assertSame(array_sum(array_map(fn ($game) => count($game['variants']), $games)), Product::count());

        $eldenRing = Game::where('slug', 'elden-ring')->firstOrFail();
        $this->assertSame('/covers/elden-ring.svg', $eldenRing->cover_image_url);
        $this->assertEqualsCanonicalizing(
            [
                'Elden Ring Steam Key GLOBAL',
                'Elden Ring Steam Key EUROPE',
                'Elden Ring Xbox Live Key EUROPE',
                'Elden Ring PlayStation Network Key EUROPE',
            ],
            $eldenRing->products->pluck('name')->all(),
        );
        $this->assertTrue(Product::where('slug', 'elden-ring-steam-key-global')->exists());
    }

    public function test_every_product_has_between_two_and_six_offers_with_sensible_prices(): void
    {
        $this->seed(CatalogSeeder::class);

        foreach (Product::withCount('offers')->get() as $product) {
            $this->assertGreaterThanOrEqual(2, $product->offers_count, $product->name);
            $this->assertLessThanOrEqual(6, $product->offers_count, $product->name);
        }

        $this->assertSame(0, Offer::where('price_cents', '<', 99)->count());
        // Shop-style endings only.
        $this->assertSame(0, Offer::whereRaw('price_cents % 100 NOT IN (29, 49, 79, 99)')->count());
        // Some offers are discounted, and not all of them.
        $discounted = Offer::whereNotNull('original_price_cents')->count();
        $this->assertGreaterThan(0, $discounted);
        $this->assertLessThan(Offer::count(), $discounted);
    }

    public function test_only_the_variants_marked_sold_out_have_nothing_in_stock(): void
    {
        $this->seed(CatalogSeeder::class);

        $markedSoldOut = collect($this->gamesFile())
            ->sum(fn ($game) => collect($game['variants'])->where('stock', 'none')->count());
        $this->assertGreaterThan(0, $markedSoldOut, 'the data should include sold-out examples');

        $soldOut = Product::query()->withBestOffer()->get()->reject->isInStock();

        $this->assertCount($markedSoldOut, $soldOut);
        $this->assertContains('EA Play 12 Months GLOBAL', $soldOut->pluck('name')->all());
    }

    public function test_seeding_an_empty_database_twice_gives_exactly_the_same_catalog(): void
    {
        $this->seed(CatalogSeeder::class);
        $first = $this->fingerprint();

        DB::statement('TRUNCATE license_keys, offers, products, games, sellers, platforms, regions RESTART IDENTITY CASCADE');
        $this->assertSame(0, Product::count());

        $this->seed(CatalogSeeder::class);

        $this->assertSame($first, $this->fingerprint());
    }

    public function test_seeding_again_on_top_of_existing_data_changes_nothing(): void
    {
        $this->seed(CatalogSeeder::class);
        $before = $this->fingerprint();
        $counts = [Game::count(), Product::count(), Offer::count(), LicenseKey::count()];

        $this->seed(CatalogSeeder::class);

        $this->assertSame($counts, [Game::count(), Product::count(), Offer::count(), LicenseKey::count()]);
        $this->assertSame($before, $this->fingerprint());
    }

    public function test_seeding_again_never_brings_back_a_sold_key_or_resets_a_sales_count(): void
    {
        $this->seed(CatalogSeeder::class);

        // Simulate a purchase since the first deploy.
        $key = LicenseKey::where('status', LicenseKeyStatus::Available)->firstOrFail();
        $item = OrderItem::factory()->create(['offer_id' => $key->offer_id]);
        $key->update(['status' => LicenseKeyStatus::Sold, 'order_item_id' => $item->id, 'sold_at' => now()]);
        $product = $key->offer->product;
        $product->increment('sales_count', 7);
        $salesAfterPurchase = $product->fresh()->sales_count;
        $keysBefore = LicenseKey::count();

        $this->seed(CatalogSeeder::class);

        $this->assertSame(LicenseKeyStatus::Sold, $key->fresh()->status);
        $this->assertSame($item->id, $key->fresh()->order_item_id);
        $this->assertSame($salesAfterPurchase, $product->fresh()->sales_count);
        $this->assertSame($keysBefore, LicenseKey::count(), 'no replacement key may be created for a sold one');
    }
}
