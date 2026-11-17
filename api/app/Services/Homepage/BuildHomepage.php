<?php

namespace App\Services\Homepage;

use App\Models\HomepageBlock;
use App\Support\InternalPath;
use Illuminate\Contracts\Container\Container;
use Throwable;

/**
 * Assembles the homepage.
 *
 * The homepage_blocks table is the layout: which blocks, in what order,
 * with which title, link and settings. For each active row, the resolver
 * for its type supplies the content. Nothing about the homepage is decided
 * anywhere else, least of all in the frontend, which only draws what this
 * returns: hiding, reordering or retitling a block is a change to a row.
 */
class BuildHomepage
{
    /** Which class fills which type of block. */
    private const RESOLVERS = [
        'hero_banner' => HeroBannerResolver::class,
        'best_sellers' => BestSellersResolver::class,
        'deals' => DealsResolver::class,
        'featured' => FeaturedProductsResolver::class,
    ];

    public function __construct(private Container $container) {}

    /**
     * @return list<array{id: int, type: string, title: string|null, link: array{label: string, url: string}|null, data: array<string, mixed>}>
     */
    public function handle(): array
    {
        $blocks = [];

        foreach (HomepageBlock::query()->where('is_active', true)->orderBy('position')->orderBy('id')->get() as $block) {
            $data = $this->resolve($block);

            // Nothing to show: leave the block out rather than send it empty.
            if ($data === null) {
                continue;
            }

            $blocks[] = [
                'id' => $block->id,
                'type' => $block->type,
                'title' => $block->title,
                'link' => $this->link($block),
                'data' => $data,
            ];
        }

        return $blocks;
    }

    /**
     * One block's content. A type nobody resolves is skipped. A resolver
     * that fails loses its own block and is logged; the rest of the
     * homepage is still served.
     *
     * @return array<string, mixed>|null
     */
    private function resolve(HomepageBlock $block): ?array
    {
        $resolver = self::RESOLVERS[$block->type] ?? null;

        if ($resolver === null) {
            return null;
        }

        try {
            return $this->container->make($resolver)->resolve($block);
        } catch (Throwable $exception) {
            report($exception);

            return null;
        }
    }

    /**
     * The block's "see more" link, from its settings, if it stays inside
     * the site.
     *
     * @return array{label: string, url: string}|null
     */
    private function link(HomepageBlock $block): ?array
    {
        $link = $block->config['link'] ?? null;

        if (! is_array($link) || ! is_string($link['label'] ?? null) || ! InternalPath::isSafe($link['url'] ?? null)) {
            return null;
        }

        return ['label' => $link['label'], 'url' => $link['url']];
    }
}
