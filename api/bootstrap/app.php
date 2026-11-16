<?php

use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;
use Illuminate\Http\Request;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
        health: '/up',
    )
    ->withMiddleware(function (Middleware $middleware): void {
        // Lets requests coming from our own React app use the login session
        // cookie on /api routes (Sanctum's first-party SPA mode). Requests from
        // anywhere else stay stateless. See docs/ARCHITECTURE.md, "Authentication".
        $middleware->statefulApi();

        // In production the app sits behind the API host's load balancer, which
        // ends the HTTPS connection and talks plain HTTP to the container. The
        // only forwarded header we believe is X-Forwarded-Proto ("the visitor
        // used https"). The forwarded host and client address are NOT believed:
        // anyone who calls the API host directly can set them to anything.
        // Public URLs come from APP_URL instead (AppServiceProvider), and rate
        // limiting reads addresses explicitly (App\Support\ClientAddress).
        if (env('TRUSTED_PROXIES') === '*') {
            $middleware->trustProxies(at: '*', headers: Request::HEADER_X_FORWARDED_PROTO);
        }

        // This is an API: a signed-out caller gets a 401 response, never a
        // redirect to a login page (there is none to redirect to).
        $middleware->redirectGuestsTo(fn () => null);
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
