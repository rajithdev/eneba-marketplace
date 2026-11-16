<?php

namespace Tests\Feature\Auth;

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Hash;
use Illuminate\Testing\TestResponse;
use Tests\TestCase;

/**
 * Note on CSRF: Laravel switches its CSRF check off while PHPUnit runs, so
 * it cannot be tested here. It is tested against a running server by
 * scripts/deploy/verify-deployment.mjs.
 */
class AuthenticationTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();

        // Requests carrying the React app's Origin are the ones allowed a
        // session; this is what a browser on the frontend sends.
        $this->withHeader('Origin', config('app.frontend_url'));
    }

    /**
     * Make the next request the way a browser would make a later one: nothing
     * remembered in PHP memory, only the session cookie the server sent back.
     * Without this, the framework's test client keeps the signed-in user in
     * memory between requests and the tests would pass without any cookie.
     */
    private function asLaterRequestWithCookiesFrom(?TestResponse $response): static
    {
        $this->app['auth']->forgetGuards();
        // Empty the in-memory session too; its saved copy stays in the session
        // storage and is found again only through the cookie's session id.
        $this->app['session']->driver()->flush();
        $this->defaultCookies = [];

        if ($response && $cookie = $response->getCookie(config('session.cookie'))) {
            // The test client only attaches cookies to JSON requests when asked to.
            $this->withCredentials()->withCookie($cookie->getName(), $cookie->getValue());
        }

        return $this;
    }

    public function test_a_visitor_can_register_and_is_signed_in(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'correct-horse-battery',
        ]);

        $response->assertCreated()->assertExactJson([
            'data' => ['id' => User::first()->id, 'name' => 'Ada Lovelace', 'email' => 'ada@example.com'],
        ]);
        $this->assertAuthenticated('web');

        $this->asLaterRequestWithCookiesFrom($response)
            ->getJson('/api/auth/me')
            ->assertOk()
            ->assertJsonPath('data.email', 'ada@example.com');
    }

    public function test_the_password_is_stored_hashed_and_never_returned(): void
    {
        $response = $this->postJson('/api/auth/register', [
            'name' => 'Ada Lovelace',
            'email' => 'ada@example.com',
            'password' => 'correct-horse-battery',
        ]);

        $stored = User::first()->password;
        $this->assertNotSame('correct-horse-battery', $stored);
        $this->assertTrue(Hash::check('correct-horse-battery', $stored));
        $this->assertStringNotContainsString('password', $response->getContent());
    }

    public function test_registration_rejects_a_duplicate_email_and_a_short_password(): void
    {
        User::factory()->create(['email' => 'ada@example.com']);

        $this->postJson('/api/auth/register', [
            'name' => 'Someone Else',
            'email' => 'ada@example.com',
            'password' => 'short',
        ])->assertUnprocessable()->assertJsonValidationErrors(['email', 'password']);

        $this->assertSame(1, User::count());
    }

    public function test_a_user_can_sign_in_and_stays_signed_in_through_the_session_cookie(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery']);

        $login = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'correct-horse-battery']);

        $login->assertOk()->assertJsonPath('data.email', $user->email);
        $login->assertCookie(config('session.cookie'));

        $this->asLaterRequestWithCookiesFrom($login)->getJson('/api/auth/me')
            ->assertOk()->assertJsonPath('data.id', $user->id);

        // The same request without the cookie is anonymous.
        $this->asLaterRequestWithCookiesFrom(null)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_signing_in_issues_a_new_session_id(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery']);

        $before = $this->get('/api/sanctum/csrf-cookie');
        $sessionBefore = $before->getCookie(config('session.cookie'))->getValue();

        $login = $this->asLaterRequestWithCookiesFrom($before)
            ->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'correct-horse-battery']);

        $this->assertNotSame($sessionBefore, $login->getCookie(config('session.cookie'))->getValue());
    }

    public function test_wrong_credentials_are_rejected_without_revealing_which_part_was_wrong(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery']);

        $wrongPassword = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'nope-nope-nope']);
        $unknownEmail = $this->postJson('/api/auth/login', ['email' => 'nobody@example.com', 'password' => 'nope-nope-nope']);

        $wrongPassword->assertUnprocessable()->assertJsonValidationErrors('email');
        $this->assertSame($wrongPassword->json('errors'), $unknownEmail->json('errors'));
        $this->assertGuest('web');
    }

    public function test_the_current_user_endpoint_requires_a_signed_in_user(): void
    {
        $this->getJson('/api/auth/me')
            ->assertUnauthorized()
            ->assertExactJson(['message' => 'Unauthenticated.']);
    }

    public function test_signing_out_destroys_the_session_on_the_server(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery']);
        $login = $this->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'correct-horse-battery']);

        $this->asLaterRequestWithCookiesFrom($login)->postJson('/api/auth/logout')->assertNoContent();

        // Replaying the old cookie (as a thief who copied it would) no longer works.
        $this->asLaterRequestWithCookiesFrom($login)->getJson('/api/auth/me')->assertUnauthorized();
    }

    public function test_signing_out_requires_being_signed_in(): void
    {
        $this->postJson('/api/auth/logout')->assertUnauthorized();
    }

    public function test_sign_in_is_only_available_to_requests_from_the_web_app(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery']);

        // No Origin or Referer header: not our frontend, so no session exists.
        $this->flushHeaders()
            ->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'correct-horse-battery'])
            ->assertStatus(400);

        $this->assertGuest('web');
    }

    public function test_requests_from_another_website_do_not_get_a_session(): void
    {
        $user = User::factory()->create(['password' => 'correct-horse-battery']);

        $this->flushHeaders()->withHeader('Origin', 'https://evil.example')
            ->postJson('/api/auth/login', ['email' => $user->email, 'password' => 'correct-horse-battery'])
            ->assertStatus(400);
    }

    public function test_password_guessing_against_one_account_is_limited_even_from_changing_addresses(): void
    {
        foreach (range(1, 10) as $attempt) {
            $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.'.$attempt])
                ->postJson('/api/auth/login', ['email' => 'Victim@example.com', 'password' => 'guess-'.$attempt])
                ->assertUnprocessable();
        }

        $this->withServerVariables(['REMOTE_ADDR' => '203.0.113.99'])
            ->postJson('/api/auth/login', ['email' => 'victim@example.com', 'password' => 'guess-11'])
            ->assertTooManyRequests();
    }

    public function test_repeated_sign_in_attempts_are_rate_limited(): void
    {
        foreach (range(1, 10) as $attempt) {
            $this->postJson('/api/auth/login', ['email' => 'nobody@example.com', 'password' => 'guess-'.$attempt])
                ->assertUnprocessable();
        }

        $this->postJson('/api/auth/login', ['email' => 'nobody@example.com', 'password' => 'guess-11'])
            ->assertTooManyRequests();
    }
}
