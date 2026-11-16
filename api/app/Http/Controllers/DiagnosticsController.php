<?php

namespace App\Http\Controllers;

use App\Support\ClientAddress;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Laravel\Sanctum\Http\Middleware\EnsureFrontendRequestsAreStateful;

/**
 * Reports how a request looks once it has passed through the frontend host's
 * proxy and the API host's load balancer. It exists to answer, with facts
 * rather than guesses, "why does the login cookie not work on the deployed
 * site?". It never returns cookie values, tokens or configuration secrets, and
 * it is disabled (404) unless DEPLOY_DIAGNOSTICS=true.
 */
class DiagnosticsController extends Controller
{
    public function __invoke(Request $request): JsonResponse
    {
        abort_unless(config('app.deploy_diagnostics'), 404);

        return response()->json([
            // Which code is running: repository and commit, as set by the host.
            'deployment' => config('app.deployment'),
            'what_laravel_concluded' => [
                'scheme' => $request->getScheme(),
                'is_secure' => $request->isSecure(),
                'host' => $request->getHost(),
                'client_ip' => $request->ip(),
                // Sanctum's decision: is this request from our own frontend?
                'treated_as_frontend_request' => EnsureFrontendRequestsAreStateful::fromFrontend($request),
                'session_started' => $request->hasSession(),
                'signed_in' => $request->user('sanctum') !== null,
                // Root of the links the app generates (always APP_URL in production).
                'generated_url' => url('/api'),
                'rate_limit_addresses' => [
                    'claimed' => ClientAddress::claimed($request),
                    'edge' => ClientAddress::edge($request),
                ],
            ],
            'what_arrived' => [
                'host_header' => $request->headers->get('host'),
                'x_forwarded_host' => $request->headers->get('x-forwarded-host'),
                'x_forwarded_proto' => $request->headers->get('x-forwarded-proto'),
                'x_forwarded_for' => $request->headers->get('x-forwarded-for'),
                'cf_connecting_ip' => $request->headers->get('cf-connecting-ip'),
                'remote_addr' => $request->server('REMOTE_ADDR'),
                'origin' => $request->headers->get('origin'),
                'referer' => $request->headers->get('referer'),
                'sec_fetch_site' => $request->headers->get('sec-fetch-site'),
                'has_xsrf_header' => $request->headers->has('x-xsrf-token'),
                // Names only, never values.
                'cookie_names' => array_keys($request->cookies->all()),
            ],
            'configuration' => [
                'environment' => config('app.env'),
                'debug' => (bool) config('app.debug'),
                'app_url' => config('app.url'),
                'frontend_url' => config('app.frontend_url'),
                'stateful_domains' => config('sanctum.stateful'),
                'session_cookie_name' => config('session.cookie'),
                'session_secure_cookie' => config('session.secure'),
                'session_domain' => config('session.domain'),
                'database_sslmode' => config('database.connections.pgsql.sslmode'),
            ],
        ]);
    }
}
