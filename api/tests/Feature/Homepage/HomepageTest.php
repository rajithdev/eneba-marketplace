<?php

namespace Tests\Feature\Homepage;

use App\Models\Banner;
use App\Models\Game;
use App\Models\HomepageBlock;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Product;
use App\Services\Homepage\DealsResolver;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Exceptions;
use RuntimeException;
use Tests\TestCase;

/** GET /api/homepage: the layout comes from rows, the content from resolvers. */
class HomepageTest extends TestCase
{
    use RefreshDatabase;

    /** @param array<string, mixed> $attributes */
    private function block(string $type, array $attributes = []): HomepageBlock
    {
        return HomepageBlock::create(['type' => $type, 'title' => ucfirst($type), 'position' => 0, 'config' => [], ...$attributes]);
    }

    /** @param array<string, mixed> $attributes */
    private function banner(array $attributes = []): Banner
    {
        return Banner::create(['title' => 'A banner', 'link_url' => '/store', 'position' => 0, ...$attributes]);
    }

    /** A product that can be bought, with this many past sales. */
    private function product(int $sales = 0, int $priceCents = 1000, ?int $wasCents = null): Product
    {
        $product = Product::factory()->create(['sales_count' => $sales]);
        $offer = Offer::factory()->for($product)->create(['price_cents' => $priceCents, 'original_price_cents' => $wasCents]);
        LicenseKey::factory()->for($offer)->create();

        return $product;
    }

    /** @return list<string> the slugs a block shows, in order */
    private function shown(string $type): array
    {
        $block = collect($this->getJson('/api/homepage')->assertOk()->json('data.blocks'))->firstWhere('type', $type);

        return array_column($block['data']['products'] ?? [], 'slug');
    }

    // ------------------------------------------------------------ layout ---

    public function test_blocks_come_back_in_the_order_of_their_rows(): void
    {
        $this->banner();
        $this->product();
        $sellers = $this->block('best_sellers', ['position' => 20, 'title' => 'Best sellers']);
        $hero = $this->block('hero_banner', ['position' => 10, 'title' => null]);

        $this->getJson('/api/homepage')->assertOk()
            ->assertJsonPath('data.blocks.0.type', 'hero_banner')
            ->assertJsonPath('data.blocks.0.id', $hero->id)
            ->assertJsonPath('data.blocks.0.title', null)
            ->assertJsonPath('data.blocks.1.type', 'best_sellers')
            ->assertJsonPath('data.blocks.1.title', 'Best sellers');

        // Reordering the page is a change to two rows, nothing else.
        $sellers->update(['position' => 5]);

        $this->getJson('/api/homepage')
            ->assertJsonPath('data.blocks.0.type', 'best_sellers')
            ->assertJsonPath('data.blocks.1.type', 'hero_banner');
    }

    public function test_a_block_switched_off_disappears_and_a_renamed_one_is_renamed(): void
    {
        $this->banner();
        $this->product();
        $hero = $this->block('hero_banner', ['position' => 1]);
        $sellers = $this->block('best_sellers', ['position' => 2, 'title' => 'Best sellers']);

        $hero->update(['is_active' => false]);
        $sellers->update(['title' => 'What everyone is buying']);

        $this->getJson('/api/homepage')
            ->assertJsonCount(1, 'data.blocks')
            ->assertJsonPath('data.blocks.0.title', 'What everyone is buying');
    }

    public function test_the_same_type_can_appear_twice_with_different_settings(): void
    {
        foreach (range(1, 4) as $sales) {
            $this->product($sales);
        }
        $this->block('best_sellers', ['position' => 1, 'title' => 'Top two', 'config' => ['limit' => 2]]);
        $this->block('best_sellers', ['position' => 2, 'title' => 'Top four', 'config' => ['limit' => 4]]);

        $this->getJson('/api/homepage')
            ->assertJsonCount(2, 'data.blocks.0.data.products')
            ->assertJsonCount(4, 'data.blocks.1.data.products');
    }

    public function test_a_block_links_onward_only_to_a_path_inside_the_site(): void
    {
        $this->product();
        $this->block('best_sellers', ['position' => 1, 'config' => ['link' => ['label' => 'See all', 'url' => '/store?sort=popular']]]);

        $this->getJson('/api/homepage')->assertJsonPath('data.blocks.0.link', ['label' => 'See all', 'url' => '/store?sort=popular']);

        foreach (['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', '', null, ['x']] as $url) {
            HomepageBlock::query()->update(['config' => ['link' => ['label' => 'See all', 'url' => $url]]]);

            $this->getJson('/api/homepage')->assertJsonPath('data.blocks.0.link', null);
        }
    }

    public function test_an_empty_layout_is_an_empty_list_not_an_error(): void
    {
        $this->getJson('/api/homepage')->assertOk()->assertExactJson(['data' => ['blocks' => []]]);
    }

    // ---------------------------------------------------------- fallbacks ---

    public function test_a_block_with_nothing_to_show_is_left_out(): void
    {
        $this->product();
        $this->block('hero_banner', ['position' => 1]);   // no banners exist
        $this->block('deals', ['position' => 2]);         // nothing is discounted
        $this->block('featured', ['position' => 3]);      // nothing was picked
        $this->block('best_sellers', ['position' => 4]);

        $this->getJson('/api/homepage')
            ->assertJsonCount(1, 'data.blocks')
            ->assertJsonPath('data.blocks.0.type', 'best_sellers');
    }

    public function test_a_row_of_a_type_nobody_knows_is_skipped(): void
    {
        $this->product();
        $this->block('countdown_timer', ['position' => 1]);
        $this->block('best_sellers', ['position' => 2]);

        $this->getJson('/api/homepage')->assertOk()
            ->assertJsonCount(1, 'data.blocks')
            ->assertJsonPath('data.blocks.0.type', 'best_sellers');
    }

    public function test_one_block_failing_does_not_take_the_page_down(): void
    {
        Exceptions::fake();
        $this->product(wasCents: 2000);
        $this->block('best_sellers', ['position' => 1]);
        $this->block('deals', ['position' => 2]);
        $this->block('featured', ['position' => 3, 'config' => ['products' => [Product::firstOrFail()->slug]]]);

        $this->app->bind(DealsResolver::class, fn () => new class extends DealsResolver
        {
            public function resolve(HomepageBlock $block): ?array
            {
                throw new RuntimeException('The deals source is down.');
            }
        });

        $this->getJson('/api/homepage')->assertOk()
            ->assertJsonCount(2, 'data.blocks')
            ->assertJsonPath('data.blocks.0.type', 'best_sellers')
            ->assertJsonPath('data.blocks.1.type', 'featured');
        Exceptions::assertReported(RuntimeException::class);
    }

    public function test_settings_that_make_no_sense_fall_back_to_sensible_ones(): void
    {
        foreach (range(1, 14) as $sales) {
            $this->product($sales, wasCents: 2000);
        }
        $sellers = $this->block('best_sellers', ['position' => 1]);
        $deals = $this->block('deals', ['position' => 2]);

        foreach ([['limit' => 0, 'shown' => 1], ['limit' => 999, 'shown' => 12], ['limit' => 'many', 'shown' => 6], ['limit' => null, 'shown' => 6], ['limit' => -4, 'shown' => 1]] as $case) {
            $sellers->update(['config' => ['limit' => $case['limit']]]);
            $deals->update(['config' => ['limit' => $case['limit'], 'min_discount_percent' => 'lots']]);

            $this->getJson('/api/homepage')->assertOk()
                ->assertJsonCount($case['shown'], 'data.blocks.0.data.products')
                ->assertJsonCount($case['shown'], 'data.blocks.1.data.products');
        }
    }

    // -------------------------------------------------------- hero banner ---

    public function test_the_hero_shows_active_banners_in_their_own_order(): void
    {
        $this->block('hero_banner', ['config' => ['limit' => 2]]);
        $this->banner(['title' => 'Third', 'position' => 30]);
        $this->banner(['title' => 'First', 'position' => 10, 'subtitle' => 'Sub', 'image_url' => '/covers/a.svg', 'link_url' => '/store?type=dlc', 'cta_label' => 'Look']);
        $this->banner(['title' => 'Hidden', 'position' => 15, 'is_active' => false]);
        $this->banner(['title' => 'Second', 'position' => 20]);

        $this->getJson('/api/homepage')->assertOk()
            ->assertJsonCount(2, 'data.blocks.0.data.banners')
            ->assertJsonPath('data.blocks.0.data.banners.0', ['title' => 'First', 'subtitle' => 'Sub', 'image_url' => '/covers/a.svg', 'link_url' => '/store?type=dlc', 'cta_label' => 'Look'])
            ->assertJsonPath('data.blocks.0.data.banners.1.title', 'Second');
    }

    public function test_a_banner_can_only_link_inside_the_site_and_use_the_sites_own_artwork(): void
    {
        $this->block('hero_banner');
        $this->banner(['title' => 'Leads away', 'link_url' => 'https://evil.example/login', 'position' => 1]);
        $this->banner(['title' => 'Script', 'link_url' => 'javascript:alert(1)', 'position' => 2]);
        $this->banner(['title' => 'Fine', 'link_url' => '/store', 'image_url' => 'https://tracker.example/pixel.gif', 'position' => 3]);

        $this->getJson('/api/homepage')->assertOk()
            ->assertJsonCount(1, 'data.blocks.0.data.banners')
            ->assertJsonPath('data.blocks.0.data.banners.0.title', 'Fine')
            ->assertJsonPath('data.blocks.0.data.banners.0.image_url', null);
    }

    // ------------------------------------------------------- best sellers ---

    public function test_best_sellers_are_what_sold_most_and_can_be_bought_now(): void
    {
        $this->block('best_sellers', ['config' => ['limit' => 3]]);
        $third = $this->product(sales: 10);
        $first = $this->product(sales: 500);
        $second = $this->product(sales: 90);
        $this->product(sales: 5);
        // The all-time best seller is sold out: it is not offered.
        Offer::factory()->for(Product::factory()->create(['sales_count' => 9_999]))->create();

        $this->assertSame([$first->slug, $second->slug, $third->slug], $this->shown('best_sellers'));
    }

    public function test_a_shelf_shows_each_game_once(): void
    {
        $this->block('best_sellers', ['config' => ['limit' => 2]]);
        $game = Game::factory()->create();
        $best = $this->product(sales: 300);
        $best->update(['game_id' => $game->id]);
        $sameGameOtherPlatform = $this->product(sales: 200);
        $sameGameOtherPlatform->update(['game_id' => $game->id]);
        $other = $this->product(sales: 100);

        $this->assertSame([$best->slug, $other->slug], $this->shown('best_sellers'));
    }

    public function test_a_shelf_shows_the_same_price_as_the_store(): void
    {
        $this->block('best_sellers');
        $product = $this->product(priceCents: 2000, wasCents: 2500);
        // A cheaper offer that is sold out must not set the price.
        Offer::factory()->for($product)->create(['price_cents' => 100]);

        $onHomepage = $this->getJson('/api/homepage')->json('data.blocks.0.data.products.0');
        $inStore = $this->getJson('/api/products')->json('data.0');

        $this->assertSame($inStore, $onHomepage);
        $this->assertSame(2000, $onHomepage['price']['amount_cents']);
        $this->assertSame(20, $onHomepage['price']['discount_percent']);
    }

    // -------------------------------------------------------------- deals ---

    public function test_deals_are_the_biggest_discounts_a_buyer_can_actually_get(): void
    {
        $this->block('deals', ['config' => ['limit' => 3, 'min_discount_percent' => 10]]);
        $quarterOff = $this->product(priceCents: 1500, wasCents: 2000);
        $halfOff = $this->product(priceCents: 1000, wasCents: 2000);
        $this->product(priceCents: 1900, wasCents: 2000);   // 5%: below the minimum
        $this->product(priceCents: 2000);                    // no discount
        // 90% off, but that offer is sold out; what is in stock is full price.
        $soldOutDeal = $this->product(priceCents: 2000);
        Offer::factory()->for($soldOutDeal)->create(['price_cents' => 200, 'original_price_cents' => 2000]);

        $this->assertSame([$halfOff->slug, $quarterOff->slug], $this->shown('deals'));
    }

    public function test_equal_discounts_are_ordered_by_popularity(): void
    {
        $this->block('deals');
        $quiet = $this->product(sales: 1, priceCents: 1000, wasCents: 2000);
        $popular = $this->product(sales: 50, priceCents: 500, wasCents: 1000);

        $this->assertSame([$popular->slug, $quiet->slug], $this->shown('deals'));
    }

    // ----------------------------------------------------------- featured ---

    public function test_featured_products_are_the_ones_picked_in_the_order_picked(): void
    {
        $a = $this->product(sales: 1);
        $b = $this->product(sales: 500);
        $c = $this->product(sales: 50);
        $soldOut = Product::factory()->create();
        $this->block('featured', ['config' => ['products' => [$c->slug, 'no-such-product', $soldOut->slug, $a->slug, $c->slug, 42, $b->slug]]]);

        // Not by sales, not alphabetical: as listed. Unknown, sold-out,
        // repeated and malformed entries are passed over.
        $this->assertSame([$c->slug, $a->slug, $b->slug], $this->shown('featured'));
    }

    public function test_featured_respects_its_limit(): void
    {
        $products = collect(range(1, 4))->map(fn () => $this->product());
        $this->block('featured', ['config' => ['limit' => 2, 'products' => $products->pluck('slug')->all()]]);

        $this->assertSame($products->take(2)->pluck('slug')->all(), $this->shown('featured'));
    }

    // -------------------------------------------------------------- safety ---

    public function test_the_homepage_never_contains_a_license_key(): void
    {
        $this->banner();
        $product = $this->product(wasCents: 2000);
        $this->block('hero_banner');
        $this->block('best_sellers');
        $this->block('deals');
        $this->block('featured', ['config' => ['products' => [$product->slug]]]);

        $body = $this->getJson('/api/homepage')->assertOk()->assertJsonCount(4, 'data.blocks')->getContent();

        foreach (LicenseKey::pluck('code') as $code) {
            $this->assertStringNotContainsString($code, $body);
        }
    }

    public function test_the_number_of_queries_does_not_grow_with_the_catalog(): void
    {
        $this->banner();
        $this->block('hero_banner', ['position' => 1]);
        $this->block('best_sellers', ['position' => 2]);
        $this->block('deals', ['position' => 3]);
        $first = $this->product(wasCents: 2000);
        $this->block('featured', ['position' => 4, 'config' => ['products' => [$first->slug]]]);

        $count = function (): int {
            DB::enableQueryLog();
            DB::flushQueryLog();
            $this->getJson('/api/homepage')->assertOk()->assertJsonCount(4, 'data.blocks');
            DB::disableQueryLog();

            return count(DB::getQueryLog());
        };

        $small = $count();
        foreach (range(1, 30) as $sales) {
            $this->product($sales, wasCents: 2000);
        }

        $this->assertSame($small, $count());
        // The check for overdue reservations, the layout, the banners, and
        // four for each of the three product blocks (products, then their
        // games, platforms and regions).
        $this->assertSame(15, $small);
    }
}
