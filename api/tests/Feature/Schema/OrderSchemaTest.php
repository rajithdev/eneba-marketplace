<?php

namespace Tests\Feature\Schema;

use App\Enums\OrderStatus;
use App\Models\Offer;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\Concerns\AssertsDatabaseConstraints;
use Tests\TestCase;

class OrderSchemaTest extends TestCase
{
    use AssertsDatabaseConstraints, RefreshDatabase;

    public function test_the_same_checkout_attempt_cannot_create_two_orders(): void
    {
        $user = User::factory()->create();
        Order::factory()->for($user)->create(['idempotency_key' => 'attempt-1']);

        $this->assertViolatesConstraint(
            'orders_user_id_idempotency_key_unique',
            fn () => Order::factory()->for($user)->create(['idempotency_key' => 'attempt-1']),
        );
    }

    public function test_idempotency_keys_are_scoped_to_the_user(): void
    {
        Order::factory()->create(['idempotency_key' => 'attempt-1']);
        Order::factory()->create(['idempotency_key' => 'attempt-1']);

        $this->assertSame(2, Order::where('idempotency_key', 'attempt-1')->count());
    }

    public function test_a_buyer_cannot_have_two_unpaid_orders_at_once(): void
    {
        $user = User::factory()->create();
        Order::factory()->for($user)->create();

        $this->assertViolatesConstraint(
            'orders_one_pending_per_user',
            fn () => Order::factory()->for($user)->create(),
        );
    }

    public function test_the_one_unpaid_order_rule_counts_only_unpaid_orders_of_that_buyer(): void
    {
        $user = User::factory()->create();
        // Any number of finished orders, then one unpaid one.
        Order::factory()->for($user)->paid()->count(2)->create();
        Order::factory()->for($user)->create(['status' => OrderStatus::Cancelled]);
        $pending = Order::factory()->for($user)->create();
        // Another buyer's unpaid order is not in the way.
        Order::factory()->create();

        // Once it is no longer unpaid, the next checkout can begin.
        $pending->update(['status' => OrderStatus::Expired]);
        Order::factory()->for($user)->create();

        $this->assertSame(1, $user->orders()->where('status', OrderStatus::Pending)->count());
        $this->assertSame(5, $user->orders()->count());
    }

    public function test_order_status_must_be_a_known_value(): void
    {
        $order = Order::factory()->create();

        $this->assertViolatesConstraint(
            'orders_status_check',
            fn () => DB::table('orders')->where('id', $order->id)->update(['status' => 'refunded']),
        );
    }

    public function test_an_order_is_paid_exactly_when_it_has_a_payment_time(): void
    {
        $order = Order::factory()->create();

        $this->assertViolatesConstraint(
            'orders_paid_at_check',
            fn () => DB::table('orders')->where('id', $order->id)->update(['status' => 'paid']),
        );
        $this->assertViolatesConstraint(
            'orders_paid_at_check',
            fn () => DB::table('orders')->where('id', $order->id)->update(['paid_at' => now()]),
        );

        DB::table('orders')->where('id', $order->id)->update(['status' => 'paid', 'paid_at' => now()]);
        $this->assertSame('paid', DB::table('orders')->where('id', $order->id)->value('status'));
    }

    public function test_orders_and_payments_can_be_cancelled(): void
    {
        $order = Order::factory()->create();
        $payment = Payment::factory()->for($order)->create();

        DB::table('orders')->where('id', $order->id)->update(['status' => 'cancelled']);
        DB::table('payments')->where('id', $payment->id)->update(['status' => 'cancelled']);

        $this->assertViolatesConstraint(
            'payments_status_check',
            fn () => DB::table('payments')->where('id', $payment->id)->update(['status' => 'refunded']),
        );
    }

    public function test_the_payment_provider_decides_a_reference_only_once(): void
    {
        $charge = ['reference' => 'order-1', 'status' => 'succeeded', 'created_at' => now(), 'updated_at' => now()];
        DB::table('simulated_charges')->insert($charge);

        $this->assertViolatesConstraint(
            'simulated_charges_reference_unique',
            fn () => DB::table('simulated_charges')->insert([...$charge, 'status' => 'cancelled']),
        );
    }

    public function test_an_order_can_be_charged_only_once(): void
    {
        $order = Order::factory()->create();
        Payment::factory()->for($order)->create();

        $this->assertViolatesConstraint(
            'payments_order_id_unique',
            fn () => Payment::factory()->for($order)->create(),
        );
    }

    public function test_an_order_cannot_list_the_same_offer_twice(): void
    {
        $order = Order::factory()->create();
        $offer = Offer::factory()->create();
        OrderItem::factory()->for($order)->for($offer)->create();

        $this->assertViolatesConstraint(
            'order_items_order_id_offer_id_unique',
            fn () => OrderItem::factory()->for($order)->for($offer)->create(),
        );
    }

    public function test_order_item_quantity_must_be_at_least_one(): void
    {
        $this->assertViolatesConstraint(
            'order_items_quantity_check',
            fn () => OrderItem::factory()->create(['quantity' => 0]),
        );
    }

    public function test_order_item_snapshots_the_offer_at_purchase_time(): void
    {
        $offer = Offer::factory()->create(['price_cents' => 1999]);
        $item = OrderItem::factory()->for($offer)->create();

        $offer->update(['price_cents' => 2999]);
        $offer->product->update(['name' => 'Renamed Later']);

        $item->refresh();
        $this->assertSame(1999, $item->unit_price_cents);
        $this->assertNotSame('Renamed Later', $item->product_name);
    }

    public function test_order_relations_and_casts(): void
    {
        $order = Order::factory()->paid()->has(OrderItem::factory()->count(2), 'items')->create();
        Payment::factory()->for($order)->create();

        $this->assertSame(OrderStatus::Paid, $order->status);
        $this->assertCount(2, $order->items);
        $this->assertSame($order->total_cents, $order->payment->amount_cents);
        $this->assertTrue($order->user->orders->contains($order));
    }
}
