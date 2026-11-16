<?php

namespace Tests\Feature;

use App\Support\ClientAddress;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Guards the settings that keep the deployed app safe. Each of these was a
 * deliberate decision; a failing test here means one was changed.
 */
class ProductionConfigTest extends TestCase
{
    public function test_only_the_frontend_address_may_use_the_login_session(): void
    {
        $this->assertSame(['localhost:5173'], config('sanctum.stateful'));
    }

    public function test_cors_allows_only_the_frontend_and_never_credentials(): void
    {
        $this->assertSame(['http://localhost:5173'], config('cors.allowed_origins'));
        $this->assertFalse(config('cors.supports_credentials'));

        // A page on another website asks permission to call the API. The reply
        // names only our frontend, never the asking site and never "*", so the
        // browser refuses to let that page read the response.
        $this->withHeaders(['Origin' => 'https://evil.example', 'Access-Control-Request-Method' => 'POST'])
            ->options('/api/auth/login')
            ->assertHeader('Access-Control-Allow-Origin', 'http://localhost:5173')
            ->assertHeaderMissing('Access-Control-Allow-Credentials');
    }

    public function test_the_session_cookie_is_http_only_lax_and_bound_to_one_host(): void
    {
        $this->assertTrue(config('session.http_only'));
        $this->assertSame('lax', config('session.same_site'));
        // No Domain attribute: the cookie belongs to exactly the host that
        // set it and is never shared with other subdomains.
        $this->assertNull(config('session.domain'));
    }

    public function test_the_csrf_cookie_route_lives_under_the_api_prefix(): void
    {
        $this->withHeader('Origin', config('app.frontend_url'))
            ->get('/api/sanctum/csrf-cookie')
            ->assertNoContent()
            ->assertCookie('XSRF-TOKEN');
    }

    public function test_api_responses_are_marked_as_not_cacheable_by_shared_caches(): void
    {
        $cacheControl = $this->getJson('/api/health')->headers->get('Cache-Control');

        $this->assertStringContainsString('private', $cacheControl);
        $this->assertStringContainsString('no-cache', $cacheControl);
    }

    public function test_the_health_check_does_not_start_a_session_or_touch_the_database(): void
    {
        $queries = 0;
        DB::listen(function () use (&$queries) {
            $queries++;
        });

        $response = $this->getJson('/api/health');

        $response->assertOk();
        $this->assertSame(0, $queries);
        $this->assertEmpty($response->headers->getCookies());
    }

    public function test_forwarded_host_and_address_headers_are_not_believed(): void
    {
        config(['app.deploy_diagnostics' => true]);

        $seen = $this->withHeaders([
            'X-Forwarded-Host' => 'evil.example',
            'X-Forwarded-For' => '203.0.113.7',
        ])->getJson('/api/_diagnostics')->json('what_laravel_concluded');

        $this->assertNotSame('evil.example', $seen['host']);
        $this->assertNotSame('203.0.113.7', $seen['client_ip']);
        $this->assertStringNotContainsString('evil.example', $seen['generated_url']);
    }

    public function test_the_edge_address_is_preferred_and_cannot_be_overridden_by_the_forwarded_header(): void
    {
        $request = Request::create('/api/health', 'GET', server: [
            'REMOTE_ADDR' => '10.0.0.5',
            'HTTP_X_FORWARDED_FOR' => '203.0.113.7, 198.51.100.4',
            'HTTP_CF_CONNECTING_IP' => '198.51.100.4',
        ]);

        $this->assertSame('203.0.113.7', ClientAddress::claimed($request));
        $this->assertSame('198.51.100.4', ClientAddress::edge($request));

        $local = Request::create('/api/health', 'GET', server: ['REMOTE_ADDR' => '10.0.0.5']);
        $this->assertSame('10.0.0.5', ClientAddress::claimed($local));
        $this->assertSame('10.0.0.5', ClientAddress::edge($local));
    }

    public function test_a_path_with_a_trailing_slash_is_served_without_a_redirect(): void
    {
        $this->getJson('/api/health/')->assertOk()->assertJsonPath('status', 'ok');
    }
}
