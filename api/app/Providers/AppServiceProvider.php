<?php

namespace App\Providers;

use App\Services\Checkout\PaymentGateway;
use App\Services\Checkout\SimulatedPaymentGateway;
use App\Support\ClientAddress;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\ServiceProvider;
use Laravel\Sanctum\Sanctum;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        // The checkout talks to "a payment gateway"; which one is decided
        // here. A real provider would be another class with the same methods.
        $this->app->bind(PaymentGateway::class, SimulatedPaymentGateway::class);
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

        // People sign in with a session cookie only; this API issues no
        // tokens. Left alone, the login library answers any request that
        // carries an "Authorization: Bearer ..." header by looking the token
        // up in a table this project does not have, which is a server
        // error. Telling it that no request carries a token makes such a
        // request an ordinary visitor (or the signed-in session it also has).
        Sanctum::getAccessTokenFromRequestUsing(fn () => null);

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

        // The cart re-prices itself whenever it changes: generous for a
        // person, limited per address like search.
        RateLimiter::for('cart', fn (Request $request) => [
            Limit::perMinute(60)->by('claimed:'.ClientAddress::claimed($request)),
            Limit::perMinute(300)->by('edge:'.ClientAddress::edge($request)),
        ]);

        // Placing, paying for and cancelling orders. These hold stock, so
        // they are limited per signed-in buyer wherever the requests come from.
        RateLimiter::for('checkout', fn (Request $request) => [
            Limit::perMinute(30)->by('user:'.$request->user()?->id),
        ]);

        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(10)->by('claimed:'.ClientAddress::claimed($request)),
            Limit::perMinute(60)->by('edge:'.ClientAddress::edge($request)),
            Limit::perMinute(10)->by('email:'.strtolower((string) $request->input('email'))),
        ]);
    }
}
