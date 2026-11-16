<?php

namespace App\Http\Controllers;

use App\Enums\GameType;
use App\Enums\ProductSort;
use App\Http\Requests\ListProductsRequest;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use App\Support\Price;
use App\Support\SearchTerm;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

/**
 * Everything the store's filter panel and sort menu need to draw themselves.
 * The frontend hardcodes none of it: a new platform, region or sort order
 * appears in the store by existing here.
 */
class CatalogFilterController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $option = fn ($row) => ['slug' => $row->slug, 'name' => $row->name, 'products_count' => $row->products_count];

        $productsPerType = DB::table('products')
            ->join('games', 'games.id', '=', 'products.game_id')
            ->groupBy('games.type')
            ->selectRaw('games.type, count(*) as total')
            ->pluck('total', 'type');

        // The span of prices a buyer can currently pay, for the price slider.
        $prices = DB::query()
            ->fromSub(Product::query()->withBestOffer(), 'catalog')
            ->selectRaw('min(best_price_cents) as min_cents, max(best_price_cents) as max_cents')
            ->first();

        return response()->json([
            'data' => [
                'platforms' => Platform::withCount('products')->orderBy('name')->get()->map($option),
                'regions' => Region::withCount('products')->orderBy('name')->get()->map($option),
                'types' => array_map(fn (GameType $type) => [
                    'value' => $type->value,
                    'label' => $type->label(),
                    'products_count' => (int) ($productsPerType[$type->value] ?? 0),
                ], GameType::cases()),
                'price' => [
                    'min_cents' => $prices->min_cents === null ? null : (int) $prices->min_cents,
                    'max_cents' => $prices->max_cents === null ? null : (int) $prices->max_cents,
                    'currency' => Price::CURRENCY,
                ],
                'sorts' => array_map(fn (ProductSort $sort) => [
                    'value' => $sort->value,
                    'label' => $sort->label(),
                ], ProductSort::withoutSearch()),
                'default_sort' => ProductSort::DEFAULT->value,
                // What applies only while searching: an extra sort order, which
                // is then the default, and the limits on the search text.
                'search' => [
                    'sort' => ['value' => ProductSort::Relevance->value, 'label' => ProductSort::Relevance->label()],
                    'max_length' => SearchTerm::MAX_LENGTH,
                    'suggestions_min_length' => SearchTerm::SUGGESTIONS_MIN_LENGTH,
                ],
                'per_page' => [
                    'default' => ListProductsRequest::DEFAULT_PER_PAGE,
                    'max' => ListProductsRequest::MAX_PER_PAGE,
                ],
            ],
        ]);
    }
}
