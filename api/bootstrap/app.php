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

        // In production the app sits behind the frontend host's proxy and the
        // API host's load balancer. Trusting their X-Forwarded-* headers is
        // what tells Laravel the visitor used HTTPS and what their IP address
        // is. Unset locally (nothing is trusted); "*" in production, because
        // the load balancer's addresses are not published or stable.
        if ($proxies = env('TRUSTED_PROXIES')) {
            $middleware->trustProxies(at: $proxies === '*' ? '*' : explode(',', $proxies));
        }
    })
    ->withExceptions(function (Exceptions $exceptions): void {
        $exceptions->shouldRenderJsonWhen(
            fn (Request $request) => $request->is('api/*') || $request->expectsJson(),
        );
    })->create();
