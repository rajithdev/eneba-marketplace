<?php

namespace App\Services\Homepage;

use App\Models\HomepageBlock;
use App\Models\Product;

/**
 * Hand-picked products: the slugs listed in the block's own settings
 * ("products"), shown in that order. A slug that no longer exists, or a
 * product that is sold out, is passed over, so the shelf never promotes
 * something that cannot be bought. Settings: "products", "limit".
 */
class FeaturedProductsResolver implements BlockResolver
{
    use ListsProducts;

    public function resolve(HomepageBlock $block): ?array
    {
        $slugs = collect($block->config['products'] ?? [])->filter(fn ($slug) => is_string($slug))->unique()->values();

        if ($slugs->isEmpty()) {
            return null;
        }

        $order = $slugs->flip();

        $products = $this->purchasableProducts()
            ->whereIn('products.slug', $slugs)
            ->get()
            ->sortBy(fn (Product $product) => $order[$product->slug])
            ->take($this->limit($block, default: 5))
            ->values();

        return $this->present($products);
    }
}
