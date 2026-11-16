<?php

namespace Tests\Feature\Schema;

use App\Enums\ProductType;
use App\Models\Offer;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
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
        $this->assertSame(ProductType::Game, $product->type);
    }

    public function test_product_slug_must_be_unique(): void
    {
        Product::factory()->create(['slug' => 'elden-ring-steam-key-global']);

        $this->assertViolatesConstraint(
            'products_slug_unique',
            fn () => Product::factory()->create(['slug' => 'elden-ring-steam-key-global']),
        );
    }

    public function test_product_type_must_be_a_known_value(): void
    {
        $product = Product::factory()->create();

        $this->assertViolatesConstraint(
            'products_type_check',
            fn () => DB::table('products')->where('id', $product->id)->update(['type' => 'console']),
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
