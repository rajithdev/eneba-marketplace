<?php

namespace Tests\Feature\Account;

use App\Models\LicenseKey;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsCheckouts;
use Tests\TestCase;

/** GET /api/account/summary: the dashboard's totals, counted from the buyer's own orders. */
class AccountSummaryTest extends TestCase
{
    use BuildsCheckouts, RefreshDatabase;

    public function test_it_counts_only_the_buyers_own_orders_and_delivered_keys(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 10);

        $this->pay($buyer, $this->pendingOrder($buyer, $offer, 2))->assertOk();
        $this->pay($buyer, $this->pendingOrder($buyer, $offer, 1))->assertOk();
        $this->pay($buyer, $this->pendingOrder($buyer, $offer, 3), 'test_card_declined')->assertStatus(402);
        $this->pendingOrder($buyer, $offer, 1);

        $someoneElse = User::factory()->create();
        $this->pay($someoneElse, $this->pendingOrder($someoneElse, $offer, 2))->assertOk();

        $response = $this->actingAs($buyer)->getJson('/api/account/summary')->assertOk()
            ->assertExactJson(['data' => [
                'orders_count' => 4,
                'paid_orders_count' => 2,
                'pending_orders_count' => 1,
                // Three keys sold to the buyer; the declined and pending orders' keys are not theirs.
                'keys_count' => 3,
                'spent' => ['total_cents' => 3000, 'currency' => 'EUR'],
            ]]);

        foreach (LicenseKey::pluck('code') as $code) {
            $this->assertStringNotContainsString($code, $response->getContent());
        }
    }

    public function test_a_new_buyer_has_nothing_yet(): void
    {
        $this->actingAs(User::factory()->create())->getJson('/api/account/summary')->assertOk()
            ->assertExactJson(['data' => [
                'orders_count' => 0,
                'paid_orders_count' => 0,
                'pending_orders_count' => 0,
                'keys_count' => 0,
                'spent' => ['total_cents' => 0, 'currency' => 'EUR'],
            ]]);
    }

    public function test_it_needs_a_signed_in_user(): void
    {
        $this->getJson('/api/account/summary')->assertUnauthorized();
    }
}
