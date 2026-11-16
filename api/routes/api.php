<?php

use Illuminate\Support\Facades\Route;

/*
| Every route in this file is served under the /api prefix and returns JSON.
| Feature routes (catalog, search, auth, checkout) are added per increment.
*/

// Liveness check for the frontend and for uptime pings. It deliberately does
// not query the database: on the free tier a ping that touches the database
// would keep it awake and burn the monthly compute allowance.
Route::get('/health', fn () => response()->json(['status' => 'ok']));
