<?php

namespace App\Services\Homepage;

use App\Models\HomepageBlock;

/**
 * Products whose best price is a discount, biggest discount first, one
 * version per game.
 *
 * "Best price" is the cheapest offer that is in stock: the price the buyer
 * will actually pay. A big discount on an offer that has sold out does not
 * make a deal. Settings: "limit" (default 6) and "min_discount_percent"
 * (default 10).
 */
class DealsResolver implements BlockResolver
{
    use ListsProducts;

    public function resolve(HomepageBlock $block): ?array
    {
        $limit = $this->limit($block);
        $minimum = $block->config['min_discount_percent'] ?? 10;
        $minimum = is_numeric($minimum) ? max(1, min(99, (int) $minimum)) : 10;

        $products = $this->purchasableProducts()
            // (was - now) / was >= minimum%, written without division.
            ->whereRaw('(best.original_price_cents - best.price_cents) * 100 >= best.original_price_cents * ?', [$minimum])
            ->orderByRaw('(best.original_price_cents - best.price_cents)::numeric / best.original_price_cents DESC')
            ->orderByDesc('products.sales_count')
            ->orderBy('products.id')
            ->limit($limit * 4)
            ->get();

        return $this->present($this->onePerGame($products, $limit));
    }
}
