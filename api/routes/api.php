<?php

use App\Http\Controllers\AccountSummaryController;
use App\Http\Controllers\AuthController;
use App\Http\Controllers\CartController;
use App\Http\Controllers\CatalogFilterController;
use App\Http\Controllers\DiagnosticsController;
use App\Http\Controllers\HomepageController;
use App\Http\Controllers\OrderController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\SearchSuggestionController;
use App\Http\Middleware\ReleaseExpiredReservations;
use Illuminate\Support\Facades\Route;

/*
| Every route in this file is served under the /api prefix and returns JSON.
| Feature routes (catalog, search, checkout) are added per increment.
*/

// Liveness check for the frontend and for uptime pings. It deliberately does
// not query the database: on the free tier a ping that touches the database
// would keep it awake and burn the monthly compute allowance.
//
// "commit" is the version of this (public) repository that is running, as set
// by the host; null outside it. It lets a deployment be confirmed from outside.
Route::get('/health', fn () => response()->json([
    'status' => 'ok',
    'commit' => config('app.deployment.git_commit'),
]));

// Options for the store's filter panel.
Route::get('/filters', CatalogFilterController::class);

// Called on every pause in typing, so it has its own limit (see
// AppServiceProvider) and does none of the stock housekeeping below.
Route::get('/search/suggestions', SearchSuggestionController::class)->middleware('throttle:search');

// Everything that shows or takes stock first puts back on sale the keys of
// unpaid orders whose time is up (see ReleaseExpiredReservations).
Route::middleware(ReleaseExpiredReservations::class)->group(function () {
    // The homepage's blocks, in order. Decided by the homepage_blocks table.
    Route::get('/homepage', HomepageController::class);

    // Catalog: public, read-only.
    Route::get('/products', [ProductController::class, 'index']);
    Route::get('/products/{slug}', [ProductController::class, 'show']);

    // The cart is kept in the browser, for guests too. This prices it.
    Route::post('/cart/quote', [CartController::class, 'quote'])->middleware('throttle:cart');

    // Orders belong to a signed-in buyer. {order} is the order's public id.
    Route::middleware('auth:sanctum')->group(function () {
        Route::get('/orders', [OrderController::class, 'index']);
        // The account dashboard's totals: counts only, never a key.
        Route::get('/account/summary', AccountSummaryController::class);
        Route::get('/orders/{order}', [OrderController::class, 'show'])->whereUuid('order');

        Route::middleware('throttle:checkout')->group(function () {
            Route::post('/orders', [OrderController::class, 'store']);
            Route::post('/orders/{order}/pay', [OrderController::class, 'pay'])->whereUuid('order');
            Route::post('/orders/{order}/cancel', [OrderController::class, 'cancel'])->whereUuid('order');
        });
    });
});

Route::prefix('auth')->group(function () {
    // Limited per IP address and per email (see AppServiceProvider).
    Route::middleware('throttle:auth')->group(function () {
        Route::post('/register', [AuthController::class, 'register']);
        Route::post('/login', [AuthController::class, 'login']);
    });

    // Answers for visitors too ("nobody is signed in"), so the frontend can
    // ask on every page load without that being an error.
    Route::get('/me', [AuthController::class, 'me']);

    Route::post('/logout', [AuthController::class, 'logout'])->middleware('auth:sanctum');
});

// Off unless DEPLOY_DIAGNOSTICS=true (answers 404). See DiagnosticsController.
Route::get('/_diagnostics', DiagnosticsController::class);
