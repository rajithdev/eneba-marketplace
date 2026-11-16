<?php

namespace Database\Seeders;

use App\Enums\GameType;
use App\Enums\LicenseKeyStatus;
use App\Models\Game;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use App\Models\Seller;
use Illuminate\Database\Seeder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Loads the catalog from the curated files in database/data.
 *
 * Hand-written there: the games (title, description, type, release date,
 * a base price, a popularity score) and which platform/region variants exist,
 * plus the platforms, regions and sellers.
 *
 * Generated here: which sellers offer each variant, at what price, with how
 * many keys. Nothing is random. Every generated number is computed from a
 * hash of what it describes (for example the product and seller names), so:
 *
 *   - the same files always produce exactly the same catalog, on any machine;
 *   - adding a game does not change the offers of the existing ones;
 *   - it is safe to run on every deploy. Running it again changes nothing,
 *     and it never brings back a key that has been sold or resets a product's
 *     sales count.
 */
class CatalogSeeder extends Seeder
{
    /** Price endings that look like shop prices. */
    private const PRICE_ENDINGS = [29, 49, 79, 99];

    private const DISCOUNT_PERCENTS = [10, 15, 20, 25, 30, 40, 50];

    public function run(): void
    {
        $reference = $this->read('reference.json');
        $games = $this->read('games.json');

        DB::transaction(function () use ($reference, $games) {
            Platform::upsert($this->only($reference['platforms'], ['slug', 'name']), ['slug'], ['name']);
            Region::upsert($this->only($reference['regions'], ['slug', 'name']), ['slug'], ['name']);
            Seller::upsert($reference['sellers'], ['slug'], ['name', 'rating_percent', 'sales_count']);

            $platforms = Platform::all()->keyBy('slug');
            $regions = Region::all()->keyBy('slug');
            $sellers = Seller::orderBy('slug')->get();
            $regionPricePercent = collect($reference['regions'])->pluck('price_percent', 'slug');

            foreach ($games as $entry) {
                $game = Game::updateOrCreate(['slug' => $entry['slug']], [
                    'title' => $entry['title'],
                    'description' => $entry['description'],
                    'type' => GameType::from($entry['type']),
                    'release_date' => $entry['release_date'],
                    // One cover per game, shared by every variant.
                    'cover_image_url' => "/covers/{$entry['slug']}.svg",
                ]);

                foreach ($entry['variants'] as $variant) {
                    $platform = $platforms[$variant['platform']];
                    $region = $regions[$variant['region']];
                    $name = Product::displayName($game, $platform, $region);

                    $product = Product::updateOrCreate(['slug' => Str::slug($name)], [
                        'name' => $name,
                        'game_id' => $game->id,
                        'platform_id' => $platform->id,
                        'region_id' => $region->id,
                    ]);

                    // A starting sales figure, set once. Real purchases add to
                    // it later, so re-seeding must not put it back.
                    if ($product->wasRecentlyCreated) {
                        $product->update([
                            'sales_count' => $entry['popularity'] * $this->number("sales|{$product->slug}", 40, 160),
                        ]);
                    }

                    $this->seedOffers(
                        $product,
                        $sellers,
                        basePriceCents: intdiv($entry['base_price_cents'] * $regionPricePercent[$variant['region']], 100),
                        soldOut: ($variant['stock'] ?? null) === 'none',
                    );
                }
            }
        });
    }

    /** @param  Collection<int, Seller>  $sellers */
    private function seedOffers(Product $product, Collection $sellers, int $basePriceCents, bool $soldOut): void
    {
        // Between two and six sellers per product, chosen by hash.
        $chosen = $sellers
            ->sortBy(fn (Seller $seller) => $this->number("order|{$product->slug}|{$seller->slug}", 0, 1_000_000))
            ->take($this->number("sellers|{$product->slug}", 2, 6))
            ->values();

        $offers = [];
        $stock = [];

        foreach ($chosen as $seller) {
            $key = "{$product->slug}|{$seller->slug}";

            // Each seller prices within 12% of the base, ending in .29/.49/.79/.99.
            $price = $this->shopPrice(intdiv($basePriceCents * $this->number("price|{$key}", 88, 112), 100), "ending|{$key}");

            // About a third of the offers show a struck-through "was" price.
            $original = null;
            if ($this->number("discounted|{$key}", 0, 99) < 35) {
                $percent = self::DISCOUNT_PERCENTS[$this->number("discount|{$key}", 0, count(self::DISCOUNT_PERCENTS) - 1)];
                $original = max($price + 100, $this->shopPrice(intdiv($price * 100, 100 - $percent), "was|{$key}"));
            }

            $offers[] = [
                'product_id' => $product->id,
                'seller_id' => $seller->id,
                'price_cents' => $price,
                'original_price_cents' => $original,
                'currency' => 'EUR',
                'is_active' => true,
            ];

            // About one offer in seven has run out of keys; the rest hold 1 to 12.
            $stock[$seller->id] = $soldOut || $this->number("empty|{$key}", 0, 99) < 15
                ? 0
                : $this->number("stock|{$key}", 1, 12);
        }

        // Unless the variant is marked sold out, at least one seller has stock.
        if (! $soldOut && array_sum($stock) === 0) {
            $stock[$chosen->first()->id] = 3;
        }

        Offer::upsert($offers, ['product_id', 'seller_id'], ['price_cents', 'original_price_cents', 'currency', 'is_active']);

        $offerIds = Offer::where('product_id', $product->id)->pluck('id', 'seller_id');
        $now = now();
        $keys = [];

        foreach ($chosen as $seller) {
            for ($i = 1; $i <= $stock[$seller->id]; $i++) {
                $keys[] = [
                    'offer_id' => $offerIds[$seller->id],
                    'code' => $this->keyCode("{$product->slug}|{$seller->slug}|{$i}"),
                    'status' => LicenseKeyStatus::Available->value,
                    'created_at' => $now,
                    'updated_at' => $now,
                ];
            }
        }

        // "Or ignore": a key that already exists is left exactly as it is,
        // including one that has been reserved or sold since the first seeding.
        LicenseKey::insertOrIgnore($keys);
    }

    /**
     * A whole number between $min and $max that depends only on $key.
     * The same key always gives the same number; this replaces randomness.
     */
    private function number(string $key, int $min, int $max): int
    {
        return $min + hexdec(substr(hash('sha256', $key), 0, 8)) % ($max - $min + 1);
    }

    /** Rounds down to whole euros and adds a shop-style ending, at least 0.99. */
    private function shopPrice(int $cents, string $key): int
    {
        $ending = self::PRICE_ENDINGS[$this->number($key, 0, count(self::PRICE_ENDINGS) - 1)];

        return max(99, intdiv($cents, 100) * 100 + $ending);
    }

    /** A made-up key in the usual XXXXX-XXXXX-XXXXX shape, fixed for a given $key. */
    private function keyCode(string $key): string
    {
        return implode('-', str_split(strtoupper(substr(hash('sha256', "key|{$key}"), 0, 15)), 5));
    }

    /** @return array<int|string, mixed> */
    private function read(string $file): array
    {
        return json_decode(file_get_contents(database_path("data/{$file}")), true, flags: JSON_THROW_ON_ERROR);
    }

    /**
     * @param  array<int, array<string, mixed>>  $rows
     * @param  array<int, string>  $keys
     * @return array<int, array<string, mixed>>
     */
    private function only(array $rows, array $keys): array
    {
        return array_map(fn (array $row) => array_intersect_key($row, array_flip($keys)), $rows);
    }
}
