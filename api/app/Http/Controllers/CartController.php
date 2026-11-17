<?php

namespace App\Http\Controllers;

use App\Http\Requests\Checkout\QuoteCartRequest;
use App\Services\Checkout\QuoteCart;
use Illuminate\Http\JsonResponse;

/**
 * The cart itself lives in the visitor's browser, so guests can fill one
 * without an account. This endpoint is how the browser finds out what its
 * cart is really worth: it sends offer ids and quantities and gets back
 * names, sellers, current prices, what is still in stock and what changed.
 */
class CartController extends Controller
{
    public function quote(QuoteCartRequest $request, QuoteCart $quotes): JsonResponse
    {
        // Guests are welcome; a signed-in buyer is recognised so that keys
        // their own unpaid order holds are not shown to them as gone.
        return response()->json(['data' => $quotes->quote($request->validated('items'), $request->user('sanctum'))]);
    }
}
