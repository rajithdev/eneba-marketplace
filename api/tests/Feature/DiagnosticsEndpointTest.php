<?php

namespace Tests\Feature;

use Tests\TestCase;

class DiagnosticsEndpointTest extends TestCase
{
    public function test_it_does_not_exist_unless_switched_on(): void
    {
        $this->getJson('/api/_diagnostics')->assertNotFound();
    }

    public function test_it_reports_what_the_server_received_without_any_secret_values(): void
    {
        config(['app.deploy_diagnostics' => true]);

        $response = $this->withHeader('Origin', config('app.frontend_url'))
            ->withCredentials()
            ->withCookie('some-cookie', 'super-secret-cookie-value')
            ->getJson('/api/_diagnostics');

        $response->assertOk()
            ->assertJsonPath('what_laravel_concluded.treated_as_frontend_request', true)
            ->assertJsonPath('what_laravel_concluded.session_started', true)
            ->assertJsonPath('what_laravel_concluded.signed_in', false)
            ->assertJsonPath('configuration.stateful_domains', ['localhost:5173']);

        $this->assertContains('some-cookie', $response->json('what_arrived.cookie_names'));
        $this->assertStringNotContainsString('super-secret-cookie-value', $response->getContent());
        $this->assertStringNotContainsString(config('app.key'), $response->getContent());
    }

    public function test_a_request_from_elsewhere_is_reported_as_not_from_the_frontend(): void
    {
        config(['app.deploy_diagnostics' => true]);

        $this->withHeader('Origin', 'https://evil.example')
            ->getJson('/api/_diagnostics')
            ->assertOk()
            ->assertJsonPath('what_laravel_concluded.treated_as_frontend_request', false)
            ->assertJsonPath('what_laravel_concluded.session_started', false);
    }
}
