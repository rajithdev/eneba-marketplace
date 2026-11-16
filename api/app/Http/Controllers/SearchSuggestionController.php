<?php

namespace App\Http\Controllers;

use App\Http\Resources\ProductSummaryResource;
use App\Models\Product;
use App\Support\FuzzySearch;
use App\Support\SearchTerm;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The few best matches for what is being typed in the header's search box.
 *
 * It is the same search as the store's (Product::search, ordered by
 * relevance), limited to a handful of results, so a suggestion and the store
 * page can never disagree about what matches or what comes first.
 */
class SearchSuggestionController extends Controller
{
    public const LIMIT = 6;

    public function __invoke(Request $request): JsonResponse
    {
        $request->validate(['q' => ['sometimes', 'nullable', 'string', 'max:'.SearchTerm::MAX_LENGTH]]);

        $term = SearchTerm::from($request->query('q'));

        // Nothing typed yet, or a single letter: answer with an empty list
        // rather than an error, without asking the database anything.
        if ($term === null || mb_strlen($term->text) < SearchTerm::SUGGESTIONS_MIN_LENGTH) {
            return response()->json(['data' => []]);
        }

        $products = FuzzySearch::run(fn () => Product::query()
            ->withBestOffer()
            ->join('games', 'games.id', '=', 'products.game_id')
            ->with(['game', 'platform', 'region'])
            ->search($term)
            ->orderByRelevance()
            ->orderBy('products.id')
            ->limit(self::LIMIT)
            ->get());

        return response()->json(['data' => ProductSummaryResource::collection($products)->resolve($request)]);
    }
}
