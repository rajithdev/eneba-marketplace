<?php

namespace Tests\Feature\Checkout;

use App\Enums\LicenseKeyStatus;
use App\Enums\OrderStatus;
use App\Enums\PaymentStatus;
use App\Models\LicenseKey;
use App\Models\Order;
use App\Models\Product;
use App\Models\Seller;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\BuildsCheckouts;
use Tests\TestCase;

/** POST /api/orders/{id}/pay and /cancel: charge, then deliver or release. */
class PayOrderTest extends TestCase
{
    use BuildsCheckouts, RefreshDatabase;

    public function test_an_approved_payment_delivers_exactly_the_keys_that_were_held(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1250, keys: 5);
        $order = $this->pendingOrder($buyer, $offer, 2);
        $heldCodes = LicenseKey::where('status', LicenseKeyStatus::Reserved)->orderBy('id')->pluck('code')->all();
        $product = $offer->product;
        $seller = $offer->seller;

        $this->pay($buyer, $order)
            ->assertOk()
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonPath('data.items.0.keys', $heldCodes)
            ->assertJsonPath('data.payment', ['status' => 'succeeded', 'method' => 'Test card ending 4242'])
            ->assertJsonPath('data.expires_at', null)
            ->assertJsonPath('data.payment_methods', []);

        $order->refresh();
        $this->assertSame(OrderStatus::Paid, $order->status);
        $this->assertNotNull($order->paid_at);
        $this->assertSame(PaymentStatus::Succeeded, $order->payment->status);
        $this->assertStringStartsWith('sim_', $order->payment->provider_reference);
        $this->assertSame('succeeded', $this->charge($order));

        $this->assertSame(['available' => 3, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
        $this->assertSame(2, LicenseKey::where('status', LicenseKeyStatus::Sold)->whereNotNull('sold_at')->count());

        // Popularity follows real sales.
        $this->assertSame($product->sales_count + 2, $product->fresh()->sales_count);
        $this->assertSame($seller->sales_count + 2, $seller->fresh()->sales_count);
    }

    public function test_a_declined_payment_puts_the_keys_back_on_sale(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);
        $order = $this->pendingOrder($buyer, $offer, 2);
        $salesBefore = $offer->product->sales_count;

        $response = $this->pay($buyer, $order, 'test_card_declined')
            ->assertStatus(402)
            ->assertJsonPath('message', 'The payment was declined. You have not been charged.')
            ->assertJsonPath('data.status', 'failed')
            ->assertJsonPath('data.failure_reason', 'card_declined')
            ->assertJsonPath('data.payment.status', 'failed')
            ->assertJsonPath('data.items.0.keys', []);

        foreach (LicenseKey::pluck('code') as $code) {
            $this->assertStringNotContainsString($code, $response->getContent());
        }
        $this->assertSame(['available' => 2, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
        $this->assertSame(0, LicenseKey::whereNotNull('order_item_id')->count());
        $this->assertSame($salesBefore, $offer->product->fresh()->sales_count);

        // The stock really is back: someone else can buy it straight away.
        $other = User::factory()->create();
        $this->pay($other, $this->pendingOrder($other, $offer, 2))->assertOk();
    }

    public function test_a_key_that_was_sold_is_never_sold_again(): void
    {
        $offer = $this->offer(1000, keys: 3);
        $first = User::factory()->create();
        $soldToFirst = $this->pay($first, $this->pendingOrder($first, $offer))->assertOk()->json('data.items.0.keys.0');
        $soldKey = LicenseKey::where('code', $soldToFirst)->firstOrFail();

        // Other buyers take everything that is left.
        $second = User::factory()->create();
        $soldToSecond = $this->pay($second, $this->pendingOrder($second, $offer, 2))->assertOk()->json('data.items.0.keys');

        $this->assertNotContains($soldToFirst, $soldToSecond);
        $this->assertCount(3, array_unique([$soldToFirst, ...$soldToSecond]));
        // Nothing is left to sell, although three keys exist.
        $this->placeOrder(User::factory()->create(), [$this->item($offer)])
            ->assertConflict()
            ->assertJsonPath('quote.lines.0.issues', ['unavailable']);
        // The first key still belongs to the first buyer's order line.
        $this->assertSame($soldKey->order_item_id, $soldKey->fresh()->order_item_id);
        $this->assertSame(LicenseKeyStatus::Sold, $soldKey->fresh()->status);
    }

    public function test_the_database_refuses_to_put_a_sold_key_back_on_sale_without_clearing_its_sale(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $this->pay($buyer, $this->pendingOrder($buyer, $offer))->assertOk();

        $this->expectExceptionMessage('license_keys_state_check');

        DB::table('license_keys')->where('offer_id', $offer->id)->update(['status' => 'available']);
    }

    public function test_each_decline_reason_is_reported(): void
    {
        $buyer = User::factory()->create();
        $order = $this->pendingOrder($buyer, $this->offer());

        $this->pay($buyer, $order, 'test_card_insufficient_funds')
            ->assertStatus(402)
            ->assertJsonPath('data.failure_reason', 'insufficient_funds');
    }

    public function test_paying_twice_charges_once_and_delivers_once(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 4);
        $order = $this->pendingOrder($buyer, $offer, 2);
        $salesBefore = $offer->product->sales_count;

        $first = $this->pay($buyer, $order)->assertOk();
        // The second attempt even names a card that would be declined: the
        // order is already settled, so nothing is asked of the provider.
        $second = $this->pay($buyer, $order, 'test_card_declined')->assertOk();

        $this->assertSame($first->json('data'), $second->json('data'));
        $this->assertSame(1, DB::table('simulated_charges')->count());
        $this->assertSame(['available' => 2, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
        $this->assertSame($salesBefore + 2, $offer->product->fresh()->sales_count);
    }

    public function test_a_declined_order_cannot_be_paid_again(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder($buyer, $offer);

        $this->pay($buyer, $order, 'test_card_declined')->assertStatus(402);
        // One payment attempt per order. Trying again means a new order.
        $this->pay($buyer, $order, 'test_card_approved')->assertStatus(402)->assertJsonPath('data.status', 'failed');

        $this->assertSame('declined', $this->charge($order));
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_paying_after_the_deadline_charges_nothing_and_releases_the_keys(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder($buyer, $offer);

        $this->travel(config('checkout.reservation_minutes'))->minutes();
        $this->travel(1)->seconds();

        $this->pay($buyer, $order)
            ->assertConflict()
            ->assertJsonPath('message', 'This order can no longer be paid for. You have not been charged.')
            ->assertJsonPath('data.status', 'expired')
            ->assertJsonPath('data.payment.status', 'cancelled')
            ->assertJsonPath('data.items.0.keys', []);

        $this->assertSame('cancelled', $this->charge($order));
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_paying_a_moment_before_the_deadline_still_works(): void
    {
        $buyer = User::factory()->create();
        $order = $this->pendingOrder($buyer, $this->offer());

        $this->travel(config('checkout.reservation_minutes') * 60 - 2)->seconds();

        $this->pay($buyer, $order)->assertOk()->assertJsonPath('data.status', 'paid');
    }

    public function test_cancelling_releases_the_keys_and_the_order_can_no_longer_be_paid(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);
        $order = $this->pendingOrder($buyer, $offer, 2);

        $this->actingAs($buyer)->postJson("/api/orders/{$order->public_id}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', 'cancelled')
            ->assertJsonPath('data.payment.status', 'cancelled');

        $this->assertSame(['available' => 2, 'reserved' => 0, 'sold' => 0], $this->keys($offer));

        $this->pay($buyer, $order)->assertConflict()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame('cancelled', $this->charge($order));
        $this->assertSame(['available' => 2, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_a_paid_order_cannot_be_cancelled(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder($buyer, $offer);
        $this->pay($buyer, $order)->assertOk();

        $this->actingAs($buyer)->postJson("/api/orders/{$order->public_id}/cancel")
            ->assertOk()
            ->assertJsonPath('data.status', 'paid');

        $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 1], $this->keys($offer));
    }

    public function test_the_payment_method_must_be_one_the_gateway_offers(): void
    {
        $buyer = User::factory()->create();
        $order = $this->pendingOrder($buyer, $this->offer());

        $this->pay($buyer, $order, 'visa_4111111111111111')->assertUnprocessable()->assertJsonValidationErrors('payment_method');
        $this->actingAs($buyer)->postJson("/api/orders/{$order->public_id}/pay")->assertUnprocessable();

        $this->assertSame(OrderStatus::Pending, $order->fresh()->status);
        $this->assertNull($this->charge($order));
    }

    public function test_nobody_else_can_pay_for_or_cancel_an_order(): void
    {
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder(User::factory()->create(), $offer);
        $stranger = User::factory()->create();

        $this->pay($stranger, $order)->assertNotFound();
        $this->actingAs($stranger)->postJson("/api/orders/{$order->public_id}/cancel")->assertNotFound();

        $this->assertSame(OrderStatus::Pending, $order->fresh()->status);
        $this->assertNull($this->charge($order));
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
    }

    public function test_a_signed_out_visitor_cannot_pay_or_cancel(): void
    {
        $order = $this->pendingOrder(User::factory()->create(), $this->offer());
        auth()->forgetGuards();

        $this->postJson("/api/orders/{$order->public_id}/pay", ['payment_method' => 'test_card_approved'])->assertUnauthorized();
        $this->postJson("/api/orders/{$order->public_id}/cancel")->assertUnauthorized();

        $this->assertSame(OrderStatus::Pending, $order->fresh()->status);
    }

    public function test_sales_counters_are_raised_in_one_fixed_order_whatever_the_order_of_the_lines(): void
    {
        // Two payments locking the same counters in different orders can
        // deadlock (see SettleOrder::countSales). The fixed order is:
        // products by id, then sellers by id, each once.
        [$early, $late] = Seller::factory()->count(2)->create()->all();
        [$first, $second] = Product::factory()->count(2)->create()->all();
        // Stored in offer order, the lines run: late seller, early seller,
        // early seller again; second product, first product, second again.
        $offers = [
            $this->offer(1000, keys: 5, attributes: ['seller_id' => $late->id, 'product_id' => $second->id]),
            $this->offer(1000, keys: 5, attributes: ['seller_id' => $early->id, 'product_id' => $first->id]),
            $this->offer(1000, keys: 5, attributes: ['seller_id' => $early->id, 'product_id' => $second->id]),
        ];
        $buyer = User::factory()->create();
        $order = Order::where('public_id', $this->placeOrder($buyer, [
            $this->item($offers[0], 1), $this->item($offers[1], 2), $this->item($offers[2], 3),
        ])->assertCreated()->json('data.id'))->firstOrFail();

        $raised = [];
        DB::listen(function ($query) use (&$raised) {
            if (preg_match('/^update "(products|sellers)" set "sales_count" = "sales_count" \+ (\d+)/', $query->sql, $match)) {
                $raised[] = [$match[1], (int) $match[2], last($query->bindings)];
            }
        });

        $this->pay($buyer, $order)->assertOk();

        // [table, how many, row id]
        $this->assertSame([
            ['products', 2, $first->id],
            ['products', 4, $second->id],
            ['sellers', 5, $early->id],
            ['sellers', 1, $late->id],
        ], $raised);
    }
}
