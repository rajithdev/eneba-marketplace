<?php

namespace Tests\Feature;

use Tests\TestCase;

class HealthEndpointTest extends TestCase
{
    public function test_health_endpoint_reports_ok(): void
    {
        $this->getJson('/api/health')
            ->assertOk()
            ->assertExactJson(['status' => 'ok']);
    }

    public function test_unknown_api_routes_return_json_not_html(): void
    {
        $this->get('/api/does-not-exist')
            ->assertNotFound()
            ->assertHeader('content-type', 'application/json');
    }
}
