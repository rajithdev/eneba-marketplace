<?php

namespace App\Providers;

use App\Support\ClientAddress;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
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
        // In production every URL the app generates starts with APP_URL (the
        // public address visitors use), whatever Host or forwarded-host header
        // a request carries. Those headers can be forged on a direct call.
        if ($this->app->environment('production')) {
            URL::forceRootUrl(config('app.url'));
            URL::forceScheme(parse_url(config('app.url'), PHP_URL_SCHEME));
        }

        // Sign-in and sign-up, per minute:
        //   10 per visitor address  (accurate through the frontend)
        //   60 per edge address     (cannot be forged; shared by visitors who
        //                            arrive through the same frontend server,
        //                            hence the higher number)
        //   10 per email address    (guessing one account's password stays
        //                            limited wherever the requests come from)
        // Search suggestions are requested as the visitor types (the frontend
        // waits for a pause first). Generous for a person, a ceiling for a
        // script: 120 a minute per visitor address, 600 per edge address.
        RateLimiter::for('search', fn (Request $request) => [
            Limit::perMinute(120)->by('claimed:'.ClientAddress::claimed($request)),
            Limit::perMinute(600)->by('edge:'.ClientAddress::edge($request)),
        ]);

        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(10)->by('claimed:'.ClientAddress::claimed($request)),
            Limit::perMinute(60)->by('edge:'.ClientAddress::edge($request)),
            Limit::perMinute(10)->by('email:'.strtolower((string) $request->input('email'))),
        ]);
    }
}
