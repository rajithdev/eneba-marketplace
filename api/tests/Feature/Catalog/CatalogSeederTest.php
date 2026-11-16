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

    public function test_seeding_again_keeps_everything_that_happened_since_the_first_deploy(): void
    {
        $this->seed(CatalogSeeder::class);

        // What a running shop accumulates between two deployments:
        [$soldKey, $reservedKey, $untouchedKey] = LicenseKey::where('status', LicenseKeyStatus::Available)->orderBy('id')->take(3)->get();

        // ...a key that was bought,
        $soldItem = OrderItem::factory()->create(['offer_id' => $soldKey->offer_id]);
        $soldKey->update(['status' => LicenseKeyStatus::Sold, 'order_item_id' => $soldItem->id, 'sold_at' => now()]);

        // ...a key held for a checkout that is still in progress,
        $reservedItem = OrderItem::factory()->create(['offer_id' => $reservedKey->offer_id]);
        $reservedUntil = now()->addMinutes(15)->startOfSecond();
        $reservedKey->update(['status' => LicenseKeyStatus::Reserved, 'order_item_id' => $reservedItem->id, 'reserved_until' => $reservedUntil]);

        // ...sales counted on a product and on a seller,
        $product = $soldKey->offer->product;
        $product->increment('sales_count', 7);
        $seller = $soldKey->offer->seller;
        $seller->increment('sales_count', 7);

        // ...and an offer its seller switched off.
        $switchedOff = Offer::where('id', '!=', $soldKey->offer_id)->firstOrFail();
        $switchedOff->update(['is_active' => false]);

        $expected = [
            'product sales' => $product->fresh()->sales_count,
            'seller sales' => $seller->fresh()->sales_count,
            'keys' => LicenseKey::count(),
            'available keys' => LicenseKey::where('status', LicenseKeyStatus::Available)->count(),
        ];

        // Two more deployments.
        $this->seed(CatalogSeeder::class);
        $this->seed(CatalogSeeder::class);

        $soldKey->refresh();
        $this->assertSame(LicenseKeyStatus::Sold, $soldKey->status);
        $this->assertSame($soldItem->id, $soldKey->order_item_id);
        $this->assertNotNull($soldKey->sold_at);

        $reservedKey->refresh();
        $this->assertSame(LicenseKeyStatus::Reserved, $reservedKey->status);
        $this->assertSame($reservedItem->id, $reservedKey->order_item_id);
        $this->assertTrue($reservedUntil->equalTo($reservedKey->reserved_until));

        $this->assertSame(LicenseKeyStatus::Available, $untouchedKey->fresh()->status);
        $this->assertFalse($switchedOff->fresh()->is_active, 'an offer that was switched off must stay off');

        $this->assertSame($expected, [
            'product sales' => $product->fresh()->sales_count,
            'seller sales' => $seller->fresh()->sales_count,
            // No replacement key is created for a sold or reserved one.
            'keys' => LicenseKey::count(),
            'available keys' => LicenseKey::where('status', LicenseKeyStatus::Available)->count(),
        ]);
    }

    public function test_gift_cards_are_priced_near_face_value_and_never_shown_as_discounted(): void
    {
        $this->seed(CatalogSeeder::class);

        $giftCardOffers = Offer::whereHas('product.game', fn ($game) => $game->where('type', 'gift_card'))->with('product')->get();
        $this->assertNotEmpty($giftCardOffers);

        foreach ($giftCardOffers as $offer) {
            $this->assertNull($offer->original_price_cents, "{$offer->product->name} shows a 'was' price");
        }

        // A 20 EUR Steam card: every seller within about a euro and a half of it.
        $steamCard = $giftCardOffers->filter(fn ($offer) => str_starts_with($offer->product->name, 'Steam Wallet Gift Card 20 EUR'));
        $this->assertGreaterThanOrEqual(1850, $steamCard->min('price_cents'));
        $this->assertLessThanOrEqual(2150, $steamCard->max('price_cents'));

        // Subscriptions may be on offer, but never at more than a fifth off.
        $subscriptionOffers = Offer::whereNotNull('original_price_cents')
            ->whereHas('product.game', fn ($game) => $game->where('type', 'subscription'))->get();
        foreach ($subscriptionOffers as $offer) {
            $percent = ($offer->original_price_cents - $offer->price_cents) / $offer->original_price_cents * 100;
            $this->assertLessThanOrEqual(26, $percent);
        }
    }
}
