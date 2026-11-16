<?php

namespace App\Providers;

use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // Sign-in and sign-up: at most 10 attempts per minute per IP address
        // AND per email address. The per-email limit matters in production:
        // behind proxies the caller's IP comes from a forwarded header, which a
        // client that reaches the API host directly could forge. Guessing one
        // account's password stays limited whatever IP is claimed.
        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(10)->by('ip:'.$request->ip()),
            Limit::perMinute(10)->by('email:'.strtolower((string) $request->input('email'))),
        ]);
    }
}
