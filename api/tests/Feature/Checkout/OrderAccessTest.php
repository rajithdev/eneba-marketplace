<?php

namespace Tests\Feature\Checkout;

use App\Models\LicenseKey;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Concerns\BuildsCheckouts;
use Tests\TestCase;

/** GET /api/orders and /api/orders/{id}: who may read what. */
class OrderAccessTest extends TestCase
{
    use BuildsCheckouts, RefreshDatabase;

    public function test_the_order_history_lists_only_the_buyers_own_orders_newest_first(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 10);

        $oldest = $this->pendingOrder($buyer, $offer);
        $this->pay($buyer, $oldest)->assertOk();
        $declined = $this->pendingOrder($buyer, $offer);
        $this->pay($buyer, $declined, 'test_card_declined');
        $newest = $this->pendingOrder($buyer, $offer);

        $someoneElse = User::factory()->create();
        $this->pay($someoneElse, $this->pendingOrder($someoneElse, $offer))->assertOk();

        $response = $this->actingAs($buyer)->getJson('/api/orders')->assertOk()
            ->assertJsonPath('meta.total', 3)
            ->assertJsonPath('data.0.id', $newest->public_id)
            ->assertJsonPath('data.0.status', 'pending')
            ->assertJsonPath('data.1.id', $declined->public_id)
            ->assertJsonPath('data.1.status', 'failed')
            ->assertJsonPath('data.2.id', $oldest->public_id)
            ->assertJsonPath('data.2.status', 'paid');

        // The list never carries keys, not even for a paid order.
        $this->assertArrayNotHasKey('keys', $response->json('data.2.items.0'));
        foreach (LicenseKey::pluck('code') as $code) {
            $this->assertStringNotContainsString($code, $response->getContent());
        }
    }

    public function test_the_order_history_is_paged(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 10);
        foreach (range(1, 10) as $ignored) {
            $this->pay($buyer, $this->pendingOrder($buyer, $offer), 'test_card_declined');
        }
        $this->pendingOrder($buyer, $offer);

        $this->actingAs($buyer)->getJson('/api/orders')->assertOk()
            ->assertJsonCount(10, 'data')
            ->assertJsonPath('meta', ['current_page' => 1, 'per_page' => 10, 'total' => 11, 'last_page' => 2]);
        $this->actingAs($buyer)->getJson('/api/orders?page=2')->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_keys_are_shown_to_their_buyer_only_once_the_order_is_paid(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 3);
        $order = $this->pendingOrder($buyer, $offer, 2);

        $pending = $this->actingAs($buyer)->getJson("/api/orders/{$order->public_id}")->assertOk()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.items.0.keys', []);
        foreach (LicenseKey::pluck('code') as $code) {
            $this->assertStringNotContainsString($code, $pending->getContent());
        }

        $this->pay($buyer, $order)->assertOk();

        $keys = $this->actingAs($buyer)->getJson("/api/orders/{$order->public_id}")->assertOk()
            ->assertJsonPath('data.status', 'paid')
            ->json('data.items.0.keys');

        $this->assertCount(2, $keys);
        $this->assertEqualsCanonicalizing(
            LicenseKey::whereIn('order_item_id', $order->items->pluck('id'))->pluck('code')->all(),
            $keys,
        );
    }

    public function test_two_buyers_of_the_same_offer_each_see_only_their_own_keys(): void
    {
        $offer = $this->offer(1000, keys: 4);
        $anna = User::factory()->create();
        $ben = User::factory()->create();

        $annasKeys = $this->pay($anna, $this->pendingOrder($anna, $offer, 2))->assertOk()->json('data.items.0.keys');
        $bensKeys = $this->pay($ben, $this->pendingOrder($ben, $offer, 2))->assertOk()->json('data.items.0.keys');

        $this->assertCount(2, $annasKeys);
        $this->assertCount(2, $bensKeys);
        $this->assertSame([], array_intersect($annasKeys, $bensKeys));
    }

    public function test_another_buyers_order_looks_exactly_like_one_that_does_not_exist(): void
    {
        $owner = User::factory()->create();
        $order = $this->pendingOrder($owner, $this->offer());
        $this->pay($owner, $order)->assertOk();
        $stranger = User::factory()->create();

        $theirs = $this->actingAs($stranger)->getJson("/api/orders/{$order->public_id}")->assertNotFound();
        $missing = $this->actingAs($stranger)->getJson('/api/orders/'.Str::uuid())->assertNotFound();

        $this->assertSame('Order not found.', $theirs->json('message'));
        $this->assertSame($missing->json('message'), $theirs->json('message'));
        $this->actingAs($stranger)->getJson('/api/orders')->assertOk()->assertJsonPath('meta.total', 0);
    }

    public function test_an_order_cannot_be_looked_up_by_its_database_number(): void
    {
        $buyer = User::factory()->create();
        $order = $this->pendingOrder($buyer, $this->offer());

        $this->actingAs($buyer)->getJson("/api/orders/{$order->id}")->assertNotFound();
        $this->actingAs($buyer)->getJson("/api/orders/1' OR '1'='1")->assertNotFound();
    }

    public function test_orders_need_a_signed_in_user(): void
    {
        $order = $this->pendingOrder(User::factory()->create(), $this->offer());
        auth()->forgetGuards();

        $this->getJson('/api/orders')->assertUnauthorized();
        $this->getJson("/api/orders/{$order->public_id}")->assertUnauthorized();
    }
}
