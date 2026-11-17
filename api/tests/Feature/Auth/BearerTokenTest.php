<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * This API signs people in with a session cookie only. It issues no API
 * tokens, so a request that carries an "Authorization: Bearer ..." header
 * (an API client, a scanner) must simply be treated as carrying none. It
 * used to answer 500: the login library went looking for a token table
 * this project never created.
 */
class BearerTokenTest extends TestCase
{
    use RefreshDatabase;

    private const BEARER = ['Authorization' => 'Bearer 1|not-a-real-token'];

    protected function setUp(): void
    {
        parent::setUp();

        $this->withHeader('Origin', config('app.frontend_url'));
    }

    public function test_a_visitor_sending_a_bearer_token_is_still_just_a_visitor(): void
    {
        $this->getJson('/api/auth/me', self::BEARER)->assertOk()->assertExactJson(['data' => null]);
        $this->getJson('/api/orders', self::BEARER)->assertUnauthorized();
        $this->postJson('/api/auth/logout', [], self::BEARER)->assertUnauthorized();
        // A public route that looks for an optional signed-in buyer.
        $this->postJson('/api/cart/quote', ['items' => [['offer_id' => 1, 'quantity' => 1]]], self::BEARER)->assertOk();
    }

    public function test_a_bearer_token_never_signs_anyone_in(): void
    {
        // Even a token in the right shape for a user who exists.
        $user = User::factory()->create();

        $this->getJson('/api/auth/me', ['Authorization' => "Bearer {$user->id}|".str_repeat('a', 40)])
            ->assertOk()->assertExactJson(['data' => null]);
    }

    public function test_a_signed_in_session_works_the_same_with_a_bearer_header_present(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery']);

        $login = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'correct-horse-battery'], self::BEARER)
            ->assertOk();

        // The next request has only the session cookie and the stray header.
        $this->app['auth']->forgetGuards();
        $cookie = $login->getCookie(config('session.cookie'), false);

        $this->withUnencryptedCookie($cookie->getName(), $cookie->getValue())
            ->getJson('/api/auth/me', self::BEARER)
            ->assertOk()->assertJsonPath('data.id', $user->id);

        $this->getJson('/api/orders', self::BEARER)->assertOk()->assertJsonPath('data', []);
    }
}
