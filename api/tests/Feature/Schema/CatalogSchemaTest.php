<?php

namespace Tests\Feature\Schema;

use App\Enums\GameType;
use App\Models\Game;
use App\Models\Offer;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\Concerns\AssertsDatabaseConstraints;
use Tests\TestCase;

class CatalogSchemaTest extends TestCase
{
    use AssertsDatabaseConstraints, RefreshDatabase;

    public function test_trigram_extension_and_index_are_installed(): void
    {
        $this->assertTrue(
            DB::table('pg_extension')->where('extname', 'pg_trgm')->exists(),
            'The pg_trgm extension is required for typo-tolerant search.',
        );

        $index = DB::table('pg_indexes')
            ->where('tablename', 'products')
            ->where('indexname', 'products_name_trgm_index')
            ->value('indexdef');

        $this->assertNotNull($index);
        $this->assertStringContainsString('gin_trgm_ops', $index);
    }

    public function test_trigram_matching_finds_a_product_despite_typos_and_partial_names(): void
    {
        Product::factory()->create(['name' => 'Elden Ring Steam Key GLOBAL']);
        Product::factory()->create(['name' => 'Minecraft Java Edition Key GLOBAL']);

        // 0.4 rather than PostgreSQL's default threshold of 0.6: measured on
        // this data, one dropped letter in a nine-letter word ("mincraft")
        // scores 0.58 and would be missed by the default. The search increment
        // owns the final threshold; this test only proves the capability.
        $search = fn (string $term) => Product::query()
            ->whereRaw('word_similarity(?, name) > 0.4', [$term])
            ->orderByRaw('word_similarity(?, name) DESC', [$term])
            ->pluck('name')
            ->all();

        $this->assertSame(['Elden Ring Steam Key GLOBAL'], $search('eldn ring'));
        $this->assertSame(['Elden Ring Steam Key GLOBAL'], $search('elden r'));
        $this->assertSame(['Minecraft Java Edition Key GLOBAL'], $search('mincraft'));
        $this->assertSame([], $search('zelda'));
    }

    public function test_product_belongs_to_a_platform_and_region_and_has_offers(): void
    {
        $product = Product::factory()
            ->for(Platform::factory()->state(['name' => 'Steam', 'slug' => 'steam']))
            ->for(Region::factory()->state(['name' => 'Global', 'slug' => 'global']))
            ->has(Offer::factory()->count(3))
            ->create();

        $this->assertSame('Steam', $product->platform->name);
        $this->assertSame('Global', $product->region->name);
        $this->assertCount(3, $product->offers);
    }

    public function test_product_slug_must_be_unique(): void
    {
        Product::factory()->create(['slug' => 'elden-ring-steam-key-global']);

        $this->assertViolatesConstraint(
            'products_slug_unique',
            fn () => Product::factory()->create(['slug' => 'elden-ring-steam-key-global']),
        );
    }

    public function test_a_game_holds_the_shared_details_once_for_all_of_its_variants(): void
    {
        $game = Game::factory()->create(['title' => 'Elden Ring', 'description' => 'An open-world action RPG.']);
        $steam = Platform::factory()->create(['name' => 'Steam']);
        $xbox = Platform::factory()->create(['name' => 'Xbox Live']);
        $global = Region::factory()->create(['name' => 'Global']);
        $europe = Region::factory()->create(['name' => 'Europe']);

        foreach ([[$steam, $global], [$steam, $europe], [$xbox, $europe]] as [$platform, $region]) {
            Product::factory()->for($game)->for($platform)->for($region)->create();
        }

        $this->assertCount(3, $game->products);
        // Every variant reads the same description from the one game row...
        $this->assertSame(
            ['An open-world action RPG.'],
            $game->products->map(fn (Product $product) => $product->game->description)->unique()->all(),
        );
        // ...and the products table has no copy of it to drift out of date.
        foreach (['description', 'cover_image_url', 'type', 'release_date'] as $column) {
            $this->assertFalse(Schema::hasColumn('products', $column), "products.{$column} should live on games");
        }
    }

    public function test_a_game_is_sold_at_most_once_per_platform_and_region(): void
    {
        $existing = Product::factory()->create();

        $this->assertViolatesConstraint(
            'products_game_id_platform_id_region_id_unique',
            fn () => Product::factory()->create([
                'game_id' => $existing->game_id,
                'platform_id' => $existing->platform_id,
                'region_id' => $existing->region_id,
            ]),
        );
    }

    public function test_a_game_that_still_has_variants_cannot_be_deleted(): void
    {
        $product = Product::factory()->create();

        $this->assertViolatesConstraint('products_game_id_foreign', fn () => $product->game->delete());
    }

    public function test_game_type_must_be_a_known_value(): void
    {
        $game = Game::factory()->create();

        $this->assertSame(GameType::Game, $game->type);
        $this->assertViolatesConstraint(
            'games_type_check',
            fn () => DB::table('games')->where('id', $game->id)->update(['type' => 'console']),
        );
    }

    public function test_the_display_name_is_built_from_game_platform_and_region(): void
    {
        $steam = new Platform(['name' => 'Steam']);
        $europe = new Region(['name' => 'Europe']);

        $this->assertSame(
            'Elden Ring Steam Key EUROPE',
            Product::displayName(new Game(['title' => 'Elden Ring', 'type' => GameType::Game]), $steam, $europe),
        );
        // A gift card's title already names its platform.
        $this->assertSame(
            'Steam Wallet Gift Card 20 EUR EUROPE',
            Product::displayName(new Game(['title' => 'Steam Wallet Gift Card 20 EUR', 'type' => GameType::GiftCard]), $steam, $europe),
        );
    }

    public function test_a_platform_that_still_has_products_cannot_be_deleted(): void
    {
        $product = Product::factory()->create();

        $this->assertViolatesConstraint(
            'products_platform_id_foreign',
            fn () => $product->platform->delete(),
        );
    }
}
