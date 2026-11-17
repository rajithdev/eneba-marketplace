<?php

namespace App\Services\Homepage;

use App\Models\Banner;
use App\Models\HomepageBlock;
use App\Support\InternalPath;

/**
 * The banners at the top of the homepage, from the `banners` table: the
 * active ones, in their own order. Settings: "limit" (default 3, at most 5).
 */
class HeroBannerResolver implements BlockResolver
{
    public function resolve(HomepageBlock $block): ?array
    {
        $limit = $block->config['limit'] ?? 3;
        $limit = is_numeric($limit) ? max(1, min(5, (int) $limit)) : 3;

        $banners = Banner::query()
            ->where('is_active', true)
            ->orderBy('position')
            ->orderBy('id')
            ->get()
            // A banner whose link does not stay inside the site is not shown.
            ->filter(fn (Banner $banner) => InternalPath::isSafe($banner->link_url))
            ->take($limit)
            ->map(fn (Banner $banner) => [
                'title' => $banner->title,
                'subtitle' => $banner->subtitle,
                // Only artwork served by this site; anything else is dropped.
                'image_url' => InternalPath::isSafe($banner->image_url) ? $banner->image_url : null,
                'link_url' => $banner->link_url,
                'cta_label' => $banner->cta_label,
            ])
            ->values();

        return $banners->isEmpty() ? null : ['banners' => $banners->all()];
    }
}
