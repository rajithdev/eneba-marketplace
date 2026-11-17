<?php

namespace App\Services\Homepage;

use App\Models\HomepageBlock;

/**
 * The products that have sold the most, one version per game. The sales
 * count is raised by every completed order (see SettleOrder), so this shelf
 * follows what buyers actually do. Settings: "limit" (default 6).
 */
class BestSellersResolver implements BlockResolver
{
    use ListsProducts;

    public function resolve(HomepageBlock $block): ?array
    {
        $limit = $this->limit($block);

        $products = $this->purchasableProducts()
            ->orderByDesc('products.sales_count')
            ->orderBy('products.id')
            ->limit($limit * 4)
            ->get();

        return $this->present($this->onePerGame($products, $limit));
    }
}
