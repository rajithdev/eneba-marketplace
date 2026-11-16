<?php

namespace Tests\Feature\Catalog;

use App\Models\Game;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use Database\Seeders\CatalogSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

/**
 * Search by name, against real PostgreSQL with pg_trgm: what matches, in what
 * order, how typos are tolerated, and how it combines with everything else
 * the product list can do. The same search serves the header's suggestions.
 */
class ProductSearchTest extends TestCase
{
    use RefreshDatabase;

    /** A purchasable product called "$title Steam Key GLOBAL". */
    private function product(string $title, int $sales = 0, ?int $price = 1000, array $attributes = []): Product
    {
        $name = "{$title} Steam Key GLOBAL";
        $factory = Product::factory()->for(Game::factory()->create(['title' => $title]));

        return ($price === null ? $factory : $factory->pricedAt($price))
            ->create(['name' => $name, 'slug' => str($name)->slug(), 'sales_count' => $sales, ...$attributes]);
    }

    /** @return list<string> names in the order returned */
    private function search(string $query, string $more = ''): array
    {
        return $this->getJson('/api/products?q='.urlencode($query).$more)->assertOk()->json('data.*.name');
    }

    /** @return list<string> */
    private function suggest(string $query): array
    {
        return $this->getJson('/api/search/suggestions?q='.urlencode($query))->assertOk()->json('data.*.name');
    }

    // -------------------------------------------------------------- ranking ---

    public function test_exact_then_prefix_then_contained_then_typo_whatever_the_popularity(): void
    {
        // Popularity is the reverse of relevance, so it cannot explain the order.
        $this->product('Hades', sales: 1);                    // the title is the term
        $this->product('Hades II', sales: 10);                // starts with it
        $this->product('Tales of Hades', sales: 100);         // contains it
        $this->product('Hadas Legends', sales: 1000);         // one letter off
        $this->product('Hollow Knight', sales: 10_000);       // unrelated

        $this->assertSame(
            [
                'Hades Steam Key GLOBAL',
                'Hades II Steam Key GLOBAL',
                'Tales of Hades Steam Key GLOBAL',
                'Hadas Legends Steam Key GLOBAL',
            ],
            $this->search('hades'),
        );
    }

    public function test_within_the_same_relevance_the_more_popular_product_comes_first(): void
    {
        $this->product('Hades Quest', sales: 5);
        $this->product('Hades Arena', sales: 500);
        $this->product('Hades Tactics', sales: 50);

        $this->assertSame(
            ['Hades Arena Steam Key GLOBAL', 'Hades Tactics Steam Key GLOBAL', 'Hades Quest Steam Key GLOBAL'],
            $this->search('hades'),
        );
    }

    public function test_among_equally_relevant_products_available_ones_come_before_sold_out_ones(): void
    {
        $this->product('Hades Quest', sales: 900, price: null);   // popular but sold out
        $this->product('Hades Arena', sales: 5);

        $this->assertSame(['Hades Arena Steam Key GLOBAL', 'Hades Quest Steam Key GLOBAL'], $this->search('hades'));
    }

    public function test_an_exact_match_stays_first_even_when_it_is_sold_out(): void
    {
        $this->product('Hades', sales: 1, price: null);
        $this->product('Hades II', sales: 900);

        // Someone who typed the exact title is looking for that product.
        $this->assertSame(['Hades Steam Key GLOBAL', 'Hades II Steam Key GLOBAL'], $this->search('hades'));
    }

    public function test_a_closer_typo_match_ranks_above_a_weaker_one_whatever_the_popularity(): void
    {
        // "minecrft" is one letter short of Minecraft (score 0.78) and further
        // from Minecart (0.56). Both are near enough to match.
        $this->product('Minecraft', sales: 1);
        $this->product('Minecart Racer', sales: 900);

        $this->assertSame(
            ['Minecraft Steam Key GLOBAL', 'Minecart Racer Steam Key GLOBAL'],
            $this->search('minecrft'),
        );
    }

    public function test_equally_close_typo_matches_fall_back_to_popularity(): void
    {
        // The term resembles the word "Cyberpunk(s)" in both names equally.
        $this->product('Cyberpunk', sales: 1);
        $this->product('Cyberpunks United', sales: 900);

        $this->assertSame(
            ['Cyberpunks United Steam Key GLOBAL', 'Cyberpunk Steam Key GLOBAL'],
            $this->search('cyberpnk'),
        );
    }

    // ------------------------------------------------- what counts as a match ---

    public function test_it_matches_partial_titles_and_ignores_case(): void
    {
        $this->product('The Witcher 3: Wild Hunt');
        $this->product('Hollow Knight');

        foreach (['witcher', 'WITCHER', 'the wit', 'wild hunt', 'itch'] as $query) {
            $this->assertSame(['The Witcher 3: Wild Hunt Steam Key GLOBAL'], $this->search($query), $query);
        }
    }

    public function test_every_word_must_match_in_any_order(): void
    {
        $this->product('Elden Ring');
        $this->product('Elden Kingdoms');
        $this->product('Ring of Fire');

        $this->assertSame(['Elden Ring Steam Key GLOBAL'], $this->search('ring elden'));
        $this->assertSame(['Elden Ring Steam Key GLOBAL'], $this->search('elden   ring'));
        $this->assertCount(2, $this->search('elden'));
        // The platform and region are part of a product's name.
        $this->assertCount(3, $this->search('steam global'));
        $this->assertSame([], $this->search('elden xbox'));
    }

    public function test_common_typos_still_find_the_product_in_the_real_catalog(): void
    {
        $this->seed(CatalogSeeder::class);

        $typos = [
            'eldn ring' => 'Elden Ring',
            'mincraft' => 'Minecraft',
            'minecrfat' => 'Minecraft',
            'cyberpnk' => 'Cyberpunk 2077',
            'witchr' => 'The Witcher 3: Wild Hunt',
            'hogwards legacy' => 'Hogwarts Legacy',
            'baldurs gate' => "Baldur's Gate 3",
            'sekro' => 'Sekiro: Shadows Die Twice',
            'helldivrs' => 'Helldivers 2',
            'resdent evil' => 'Resident Evil 4',
            'teraria' => 'Terraria',
            'stardw valley' => 'Stardew Valley',
            'xbx game pass' => 'Xbox Game Pass Ultimate 1 Month',
        ];

        foreach ($typos as $typed => $expectedTitle) {
            $names = $this->search($typed);

            $this->assertNotEmpty($names, "\"{$typed}\" found nothing");
            $this->assertStringStartsWith($expectedTitle, $names[0], "\"{$typed}\" should lead to {$expectedTitle}");
        }
    }

    public function test_typo_tolerance_does_not_drag_in_unrelated_titles(): void
    {
        $this->seed(CatalogSeeder::class);

        // Each of these is close to exactly one title in the catalog.
        foreach (['mincraft' => 'Minecraft', 'sekro' => 'Sekiro', 'teraria' => 'Terraria', 'halo' => 'Halo Infinite'] as $typed => $title) {
            foreach ($this->search($typed, '&per_page=48') as $name) {
                $this->assertStringStartsWith($title, $name, "\"{$typed}\" also matched {$name}");
            }
        }
    }

    public function test_one_and_two_letter_words_match_only_the_start_of_a_word_and_never_as_typos(): void
    {
        $this->product('EA Sports FC 25');
        $this->product('Trafficker');           // "fc" is inside the word, not at its start
        $this->product('Hollow Knight');        // "ha" resembles nothing here

        $this->assertSame(['EA Sports FC 25 Steam Key GLOBAL'], $this->search('fc'));
        $this->assertSame(['EA Sports FC 25 Steam Key GLOBAL'], $this->search('fc 25'));
        $this->assertSame([], $this->search('ha'));
        // A single letter is a legitimate, if broad, search in the store.
        $this->assertSame(['Hollow Knight Steam Key GLOBAL'], $this->search('h'));
    }

    // ----------------------------------------------------------- edge cases ---

    public function test_an_empty_or_blank_search_is_no_search_at_all(): void
    {
        $this->product('Hades', sales: 1);
        $this->product('Hollow Knight', sales: 9);
        $everything = $this->getJson('/api/products')->json();

        foreach (['', '%20%20%20', '+'] as $blank) {
            $this->assertSame($everything, $this->getJson("/api/products?q={$blank}")->assertOk()->json(), "q=[{$blank}]");
        }
    }

    public function test_a_search_with_no_matches_is_an_empty_page_not_an_error(): void
    {
        $this->product('Hades');

        $this->getJson('/api/products?q=zzzzqqq')->assertOk()->assertExactJson([
            'data' => [],
            'meta' => ['current_page' => 1, 'per_page' => 24, 'total' => 0, 'last_page' => 1],
        ]);
    }

    public function test_special_characters_are_searched_for_literally_and_never_break_the_query(): void
    {
        $this->product('Hades');
        $this->product('100% Orange Juice');
        $this->product('Snake_Case Adventure');
        $this->product("Baldur's Gate 3");

        // LIKE wildcards are not wildcards here.
        $this->assertSame([], $this->search('%'));
        $this->assertSame([], $this->search('%%%'));
        // (A single character only matches the start of a word, and no word starts with "_".)
        $this->assertSame([], $this->search('_'));
        $this->assertSame(['100% Orange Juice Steam Key GLOBAL'], $this->search('100%'));
        $this->assertSame(['Snake_Case Adventure Steam Key GLOBAL'], $this->search('snake_case'));
        $this->assertSame(["Baldur's Gate 3 Steam Key GLOBAL"], $this->search("baldur's"));

        // None of these may error, and none may match.
        foreach (["'; DROP TABLE products; --", '\\', '"quoted"', '????', '🎮', '<script>alert(1)</script>', "a\u{0000}b", ')(*&^$#@!'] as $hostile) {
            $this->assertSame([], $this->search($hostile), "q=[{$hostile}]");
        }
        $this->assertTrue(Schema::hasTable('products'));
        $this->assertSame(4, Product::count());
    }

    public function test_overlong_or_malformed_search_text_is_rejected(): void
    {
        $this->getJson('/api/products?q='.str_repeat('a', 80))->assertOk();
        $this->getJson('/api/products?q='.str_repeat('a', 81))->assertUnprocessable()->assertJsonValidationErrors('q');
        $this->getJson('/api/products?q[]=hades')->assertUnprocessable()->assertJsonValidationErrors('q');
        $this->getJson('/api/search/suggestions?q='.str_repeat('a', 81))->assertUnprocessable()->assertJsonValidationErrors('q');
    }

    // ------------------------------------ with filters, sorting, pagination ---

    public function test_search_combines_with_filters(): void
    {
        $steam = Platform::factory()->create(['slug' => 'steam']);
        $xbox = Platform::factory()->create(['slug' => 'xbox-live']);
        $europe = Region::factory()->create(['slug' => 'europe']);
        $game = Game::factory()->create(['title' => 'Hades']);

        $make = fn (string $name, $platform, int $price) => Product::factory()->for($game)->for($platform)->for($europe)
            ->pricedAt($price)->create(['name' => $name]);
        $make('Hades Steam Key EUROPE', $steam, 1000);
        $make('Hades Xbox Live Key EUROPE', $xbox, 3000);
        Product::factory()->for($steam)->pricedAt(1000)->create(['name' => 'Hollow Knight Steam Key EUROPE']);

        $this->assertCount(2, $this->search('hades'));
        $this->assertSame(['Hades Steam Key EUROPE'], $this->search('hades', '&platform=steam'));
        $this->assertSame(['Hades Xbox Live Key EUROPE'], $this->search('hades', '&min_price=2000'));
        $this->assertSame([], $this->search('hades', '&platform=steam&min_price=2000'));
        $this->assertCount(2, $this->search('hades', '&region=europe&type=game'));
    }

    public function test_an_explicit_sort_order_overrides_relevance_within_the_matches(): void
    {
        $this->product('Hades', price: 3000);              // exact match, dearest
        $this->product('Hades II', price: 1000);
        $this->product('Hades Arena', price: 2000, sales: 999);
        $this->product('Hollow Knight', price: 100);

        $this->assertSame('Hades Steam Key GLOBAL', $this->search('hades')[0]);
        $this->assertSame(
            ['Hades II Steam Key GLOBAL', 'Hades Arena Steam Key GLOBAL', 'Hades Steam Key GLOBAL'],
            $this->search('hades', '&sort=price_asc'),
        );
        $this->assertSame('Hades Arena Steam Key GLOBAL', $this->search('hades', '&sort=popular')[0]);
        $this->assertSame($this->search('hades'), $this->search('hades', '&sort=relevance'));
    }

    public function test_relevance_without_a_search_term_is_just_the_default_order(): void
    {
        $this->product('Hades', sales: 1);
        $this->product('Hollow Knight', sales: 9);

        $this->assertSame(
            $this->getJson('/api/products')->json('data.*.name'),
            $this->getJson('/api/products?sort=relevance')->assertOk()->json('data.*.name'),
        );
    }

    public function test_search_results_are_paginated_without_gaps_or_repeats(): void
    {
        foreach (range(1, 7) as $i) {
            $this->product("Hades Chapter {$i}", sales: 10);
        }
        $this->product('Hollow Knight');

        $first = $this->getJson('/api/products?q=hades&per_page=3')->assertOk();
        $first->assertJsonPath('meta', ['current_page' => 1, 'per_page' => 3, 'total' => 7, 'last_page' => 3]);

        $seen = [];
        foreach ([1, 2, 3] as $page) {
            $seen = [...$seen, ...$this->getJson("/api/products?q=hades&per_page=3&page={$page}")->json('data.*.slug')];
        }
        $this->assertCount(7, $seen);
        $this->assertCount(7, array_unique($seen));
    }

    // ---------------------------------------------------------- suggestions ---

    public function test_suggestions_are_the_first_results_of_the_same_search(): void
    {
        $this->seed(CatalogSeeder::class);

        foreach (['elden', 'eldn ring', 'steam', 'card', 'xbx'] as $query) {
            $this->assertSame(
                array_slice($this->search($query, '&per_page=48'), 0, 6),
                $this->suggest($query),
                "suggestions for \"{$query}\" differ from the store's order",
            );
        }
        $this->assertCount(6, $this->suggest('steam'));
    }

    public function test_a_suggestion_has_the_same_shape_as_a_product_in_the_list(): void
    {
        $this->seed(CatalogSeeder::class);

        $suggestion = $this->getJson('/api/search/suggestions?q=terraria')->assertOk()->json('data.0');
        $listed = $this->getJson('/api/products?q=terraria')->json('data.0');

        $this->assertSame($listed, $suggestion);
        $this->assertSame(
            ['slug', 'name', 'type', 'cover_image_url', 'release_date', 'platform', 'region', 'in_stock', 'price', 'offers_count'],
            array_keys($suggestion),
        );
    }

    public function test_suggestions_for_nothing_or_one_letter_are_empty_and_cost_no_database_query(): void
    {
        $this->product('Hades');

        foreach (['', '%20', 'h'] as $tooShort) {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson("/api/search/suggestions?q={$tooShort}")->assertOk()->assertExactJson(['data' => []]);
            DB::disableQueryLog();

            $this->assertCount(0, DB::getQueryLog(), "q=[{$tooShort}] queried the database");
        }
        $this->getJson('/api/search/suggestions')->assertOk()->assertExactJson(['data' => []]);
        $this->assertSame(['Hades Steam Key GLOBAL'], $this->suggest('ha'));
    }

    public function test_suggestions_are_rate_limited(): void
    {
        foreach (range(1, 120) as $request) {
            $this->getJson('/api/search/suggestions?q=h')->assertOk();
        }

        $this->getJson('/api/search/suggestions?q=h')->assertTooManyRequests();
    }

    // ------------------------------------------------------------------ cost ---

    public function test_a_search_costs_a_fixed_number_of_queries(): void
    {
        $count = function (string $url): int {
            DB::flushQueryLog();
            DB::enableQueryLog();
            $this->getJson($url)->assertOk();
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };

        $this->product('Hades');
        $few = [$count('/api/products?q=hades'), $count('/api/search/suggestions?q=hades')];

        foreach (range(1, 20) as $i) {
            $this->product("Hades Chapter {$i}");
        }

        $this->assertSame($few, [$count('/api/products?q=hades'), $count('/api/search/suggestions?q=hades')]);
        // The threshold setting, then: count + page + three lookups; or one list + three lookups.
        $this->assertSame([6, 5], $few);
    }
}
