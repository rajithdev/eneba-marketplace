<?php

namespace App\Http\Controllers;

use App\Enums\LicenseKeyStatus;
use App\Enums\ProductSort;
use App\Http\Requests\ListProductsRequest;
use App\Http\Resources\OfferResource;
use App\Http\Resources\ProductSummaryResource;
use App\Models\Platform;
use App\Models\Product;
use App\Models\Region;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The store catalog: the product list and the single product page.
 *
 * A product's price is never stored. It is the cheapest offer a buyer can
 * actually purchase right now (see Product::scopeWithBestOffer), worked out
 * by the database for every request, so the list can never show a price that
 * the product page or the checkout would not honour.
 */
class ProductController extends Controller
{
    public function index(ListProductsRequest $request): JsonResponse
    {
        $filters = $request->validated();

        $products = Product::query()
            ->withBestOffer()
            // Joined for filtering by type and sorting by release date.
            ->join('games', 'games.id', '=', 'products.game_id')
            ->with(['game', 'platform', 'region'])
            ->when($filters['platform'] ?? null, fn ($query, array $slugs) => $query->whereIn(
                'products.platform_id', Platform::whereIn('slug', $slugs)->select('id'),
            ))
            ->when($filters['region'] ?? null, fn ($query, array $slugs) => $query->whereIn(
                'products.region_id', Region::whereIn('slug', $slugs)->select('id'),
            ))
            ->when($filters['type'] ?? null, fn ($query, array $types) => $query->whereIn('games.type', $types))
            // Price filters compare against the best in-stock price. A sold-out
            // product has none, so it never matches a price range.
            ->when(isset($filters['min_price']), fn ($query) => $query->where('best.price_cents', '>=', (int) $filters['min_price']))
            ->when(isset($filters['max_price']), fn ($query) => $query->where('best.price_cents', '<=', (int) $filters['max_price']))
            // Whatever the chosen order, products that can be bought come
            // first and sold-out ones after them.
            ->orderByRaw('best.price_cents IS NULL');

        match ($request->sort()) {
            ProductSort::Popular => $products->orderByDesc('products.sales_count'),
            ProductSort::PriceAsc => $products->orderBy('best.price_cents'),
            ProductSort::PriceDesc => $products->orderByDesc('best.price_cents'),
            ProductSort::Newest => $products->orderByRaw('games.release_date DESC NULLS LAST'),
        };

        // A final, unique tie-breaker: without it, products with equal values
        // could swap places between two pages.
        $page = $products->orderBy('products.id')->paginate($request->perPage());

        return response()->json([
            'data' => ProductSummaryResource::collection($page->items())->resolve($request),
            'meta' => [
                'current_page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'last_page' => $page->lastPage(),
            ],
        ]);
    }

    public function show(Request $request, string $slug): JsonResponse
    {
        $product = Product::query()
            ->withBestOffer()
            ->with(['game', 'platform', 'region'])
            ->where('products.slug', $slug)
            ->first() ?? abort(404, 'Product not found.');

        // Every offer the seller has switched on, purchasable ones first and
        // cheapest first within each group, so the first row is the best deal.
        $offers = $product->offers()
            ->where('is_active', true)
            ->with('seller')
            ->withExists(['licenseKeys as in_stock' => fn ($keys) => $keys->where('status', LicenseKeyStatus::Available)])
            ->orderByDesc('in_stock')
            ->orderBy('price_cents')
            ->orderBy('id')
            ->get();

        // The same game on other platforms and regions.
        $variants = Product::query()
            ->withBestOffer()
            ->with(['game', 'platform', 'region'])
            ->where('products.game_id', $product->game_id)
            ->whereKeyNot($product->id)
            ->orderByRaw('best.price_cents IS NULL')
            ->orderBy('best.price_cents')
            ->orderBy('products.id')
            ->get();

        return response()->json([
            'data' => [
                ...ProductSummaryResource::make($product)->resolve($request),
                // What the game is, stored once and shared by all its variants.
                'game' => [
                    'slug' => $product->game->slug,
                    'title' => $product->game->title,
                    'description' => $product->game->description,
                ],
                'offers' => OfferResource::collection($offers)->resolve($request),
                'variants' => ProductSummaryResource::collection($variants)->resolve($request),
            ],
        ]);
    }
}
