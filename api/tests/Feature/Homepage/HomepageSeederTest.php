<?php

namespace Tests\Feature\Homepage;

use App\Models\Banner;
use App\Models\Game;
use App\Models\HomepageBlock;
use App\Support\InternalPath;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\HomepageSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/** The homepage that a fresh deployment starts with. */
class HomepageSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_the_seeded_homepage_has_four_filled_blocks_in_order(): void
    {
        $this->seed(DatabaseSeeder::class);

        $blocks = $this->getJson('/api/homepage')->assertOk()->json('data.blocks');

        $this->assertSame(['hero_banner', 'best_sellers', 'deals', 'featured'], array_column($blocks, 'type'));
        $this->assertCount(3, $blocks[0]['data']['banners']);
        $this->assertCount(6, $blocks[1]['data']['products']);
        $this->assertCount(6, $blocks[2]['data']['products']);
        $this->assertCount(5, $blocks[3]['data']['products']);
        $this->assertSame(['label' => 'See the whole store', 'url' => '/store'], $blocks[1]['link']);

        // Every deal really is one, biggest first.
        $discounts = array_map(fn (array $product) => $product['price']['discount_percent'], $blocks[2]['data']['products']);
        $this->assertSame($discounts, collect($discounts)->sortDesc()->values()->all());
        $this->assertGreaterThanOrEqual(10, min($discounts));
    }

    public function test_every_seeded_banner_points_at_something_that_exists(): void
    {
        $this->seed(DatabaseSeeder::class);

        foreach (Banner::all() as $banner) {
            $this->assertTrue(InternalPath::isSafe($banner->link_url), $banner->link_url);
            // The artwork is one of this project's own covers, not a borrowed image.
            $this->assertTrue(Game::where('cover_image_url', $banner->image_url)->exists(), $banner->image_url);

            if (str_starts_with($banner->link_url, '/product/')) {
                $this->getJson('/api/products/'.substr($banner->link_url, strlen('/product/')))->assertOk();
            } else {
                $this->getJson('/api/products?'.parse_url($banner->link_url, PHP_URL_QUERY))->assertOk()->assertJsonPath('meta.total', fn (int $total) => $total > 0);
            }
        }
    }

    public function test_seeding_again_leaves_an_edited_homepage_alone(): void
    {
        $this->seed(HomepageSeeder::class);

        // Changes made by hand in the database after the first deployment.
        HomepageBlock::where('type', 'deals')->update(['position' => 1, 'title' => 'Weekend deals']);
        HomepageBlock::where('type', 'featured')->update(['is_active' => false]);
        Banner::query()->orderBy('position')->first()->update(['title' => 'Edited']);
        Banner::query()->orderByDesc('position')->first()->delete();

        // Every later deployment runs the seeder again.
        $this->seed(HomepageSeeder::class);
        $this->seed(HomepageSeeder::class);

        $this->assertSame(4, HomepageBlock::count());
        $this->assertSame('Weekend deals', HomepageBlock::where('type', 'deals')->value('title'));
        $this->assertFalse(HomepageBlock::where('type', 'featured')->value('is_active'));
        $this->assertSame(2, Banner::count());
        $this->assertSame('Edited', Banner::query()->orderBy('position')->value('title'));
    }
}
