<?php

namespace App\Services\Homepage;

use App\Http\Resources\ProductSummaryResource;
use App\Models\HomepageBlock;
use App\Models\Product;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * What the product blocks have in common: they show products that can be
 * bought right now, in the same shape and at the same price as the store.
 */
trait ListsProducts
{
    /**
     * Products with at least one offer in stock, each with its best price.
     *
     * @return Builder<Product>
     */
    protected function purchasableProducts(): Builder
    {
        return Product::query()
            ->withBestOffer()
            ->with(['game', 'platform', 'region'])
            ->whereNotNull('best.price_cents');
    }

    /**
     * How many products the block shows: its "limit" setting, kept between
     * 1 and 12 whatever the row says.
     */
    protected function limit(HomepageBlock $block, int $default = 6): int
    {
        $limit = $block->config['limit'] ?? $default;

        return is_numeric($limit) ? max(1, min(12, (int) $limit)) : $default;
    }

    /**
     * A shelf shows each game once: its first (best-ranked) version. The
     * query fetches a few rows more than the limit to allow for this.
     *
     * @param  Collection<int, Product>  $products  already in display order
     * @return Collection<int, Product>
     */
    protected function onePerGame(Collection $products, int $limit): Collection
    {
        return $products->unique('game_id')->take($limit)->values();
    }

    /**
     * The block's content, or null when no product qualified.
     *
     * @param  Collection<int, Product>  $products
     * @return array{products: list<array<string, mixed>>}|null
     */
    protected function present(Collection $products): ?array
    {
        return $products->isEmpty()
            ? null
            : ['products' => ProductSummaryResource::collection($products)->resolve(request())];
    }
}
