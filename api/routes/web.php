<?php

use Illuminate\Support\Facades\Route;

// This application is an API only; the user interface is the React app in /web.
Route::get('/', fn () => response()->json([
    'name' => config('app.name'),
    'api' => url('/api'),
]));
