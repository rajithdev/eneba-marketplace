<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\CatalogFilterController;
use App\Http\Controllers\DiagnosticsController;
use App\Http\Controllers\ProductController;
use App\Http\Controllers\SearchSuggestionController;
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

// Catalog: public, read-only.
Route::get('/filters', CatalogFilterController::class);
Route::get('/products', [ProductController::class, 'index']);
Route::get('/products/{slug}', [ProductController::class, 'show']);
// Called on every pause in typing, so it has its own limit (see AppServiceProvider).
Route::get('/search/suggestions', SearchSuggestionController::class)->middleware('throttle:search');

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
