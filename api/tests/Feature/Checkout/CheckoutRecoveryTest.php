<?php

namespace Tests\Feature\Checkout;

use App\Enums\OrderStatus;
use App\Enums\PaymentStatus;
use App\Models\Order;
use App\Models\User;
use App\Services\Checkout\ChargeResult;
use App\Services\Checkout\InventoryAllocator;
use App\Services\Checkout\PaymentGateway;
use App\Services\Checkout\SettleOrder;
use App\Services\Checkout\SimulatedPaymentGateway;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Exceptions;
use RuntimeException;
use Tests\Concerns\BuildsCheckouts;
use Tests\TestCase;

/**
 * What happens when the process stops between the steps of a purchase:
 *
 *   1. reserve keys      (order pending)
 *   2. charge            (the provider decides)
 *   3. record the result (order paid / failed / expired, keys sold / released)
 *
 * In every case the next request that touches the order must finish the job
 * exactly once: no purchase is lost, none happens twice, no key is stranded.
 */
class CheckoutRecoveryTest extends TestCase
{
    use BuildsCheckouts, RefreshDatabase;

    private function gateway(): PaymentGateway
    {
        return $this->app->make(PaymentGateway::class);
    }

    private function passTheDeadline(): void
    {
        $this->travel(config('checkout.reservation_minutes') + 1)->minutes();
    }

    public function test_a_crash_after_reserving_leaves_an_order_the_buyer_can_still_pay(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        // Step 1 happened; the process then died before any payment.
        $order = $this->pendingOrder($buyer, $offer);

        $this->actingAs($buyer)->getJson("/api/orders/{$order->public_id}")->assertOk()->assertJsonPath('data.status', 'pending');
        $this->pay($buyer, $order)->assertOk()->assertJsonPath('data.status', 'paid');
    }

    public function test_an_order_abandoned_after_reserving_expires_and_frees_its_keys(): void
    {
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder(User::factory()->create(), $offer);
        auth()->forgetGuards();

        // Before the deadline nothing is touched.
        $this->getJson('/api/products')->assertOk();
        $this->assertSame(OrderStatus::Pending, $order->fresh()->status);
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($offer));

        $this->passTheDeadline();

        // No background worker: the next visitor's request does the clean-up,
        // and already sees the product back in stock.
        $this->getJson('/api/products')->assertOk()->assertJsonPath('data.0.in_stock', true);

        $order->refresh();
        $this->assertSame(OrderStatus::Expired, $order->status);
        $this->assertSame(PaymentStatus::Cancelled, $order->payment->status);
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
        // The provider will refuse the charge from now on.
        $this->assertSame('cancelled', $this->charge($order));
    }

    public function test_a_charge_that_was_never_recorded_is_recorded_when_the_buyer_looks_at_the_order(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);
        $order = $this->pendingOrder($buyer, $offer, 2);

        // Step 2 happened at the provider; the process died before step 3.
        $this->gateway()->charge($order->public_id, $order->total_cents, 'EUR', 'test_card_approved');
        $this->assertSame(OrderStatus::Pending, $order->fresh()->status);

        $this->actingAs($buyer)->getJson("/api/orders/{$order->public_id}")->assertOk()
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonCount(2, 'data.items.0.keys');

        $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
    }

    public function test_a_buyer_who_was_charged_gets_the_keys_even_if_they_never_come_back(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder($buyer, $offer);
        $this->gateway()->charge($order->public_id, $order->total_cents, 'EUR', 'test_card_approved');
        auth()->forgetGuards();

        $this->passTheDeadline();

        // The clean-up asks the provider to cancel, learns the buyer was
        // charged, and completes the order instead of expiring it. The key
        // is never offered to the visitor who triggered the clean-up.
        $this->getJson('/api/products')->assertOk()->assertJsonPath('data.0.in_stock', false);

        $order->refresh();
        $this->assertSame(OrderStatus::Paid, $order->status);
        $this->assertSame(PaymentStatus::Succeeded, $order->payment->status);
        $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 1], $this->keys($offer));

        $this->actingAs($buyer)->getJson("/api/orders/{$order->public_id}")->assertJsonCount(1, 'data.items.0.keys');
    }

    public function test_retrying_the_payment_after_such_a_crash_charges_nothing_more(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder($buyer, $offer);
        $this->gateway()->charge($order->public_id, $order->total_cents, 'EUR', 'test_card_approved');

        $this->pay($buyer, $order)->assertOk()->assertJsonPath('data.status', 'paid');

        $this->assertDatabaseCount('simulated_charges', 1);
        $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 1], $this->keys($offer));
    }

    public function test_a_decline_that_was_never_recorded_releases_the_keys_later(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder($buyer, $offer);
        $this->gateway()->charge($order->public_id, $order->total_cents, 'EUR', 'test_card_declined');

        $this->actingAs($buyer)->getJson("/api/orders/{$order->public_id}")->assertOk()
            ->assertJsonPath('data.status', 'failed')
            ->assertJsonPath('data.failure_reason', 'card_declined');

        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_a_cancellation_that_was_never_recorded_is_finished_and_can_never_be_charged(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $order = $this->pendingOrder($buyer, $offer);

        // The provider was told to cancel; the process died before the keys
        // were released.
        $this->gateway()->cancel($order->public_id);
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($offer));

        // The buyer presses "Pay" anyway: the provider's answer stands.
        $this->pay($buyer, $order)->assertConflict()->assertJsonPath('data.status', 'cancelled');

        $this->assertSame('cancelled', $this->charge($order));
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_a_failure_while_recording_the_result_changes_nothing_and_is_finished_on_the_next_try(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);
        $order = $this->pendingOrder($buyer, $offer, 2);

        // Step 3 fails half way: the keys were already marked sold when the
        // "database" gives up.
        $this->app->bind(InventoryAllocator::class, fn () => new class extends InventoryAllocator
        {
            public function confirm(Order $order): void
            {
                parent::confirm($order);

                throw new RuntimeException('The database connection was lost.');
            }
        });

        $this->pay($buyer, $order)->assertStatus(500);

        // Nothing of step 3 stuck: not the order, not the payment, not one key.
        $order->refresh();
        $this->assertSame(OrderStatus::Pending, $order->status);
        $this->assertSame(PaymentStatus::Pending, $order->payment->status);
        $this->assertSame(['available' => 0, 'reserved' => 2, 'sold' => 0], $this->keys($offer));
        // The charge itself did happen.
        $this->assertSame('succeeded', $this->charge($order));

        $this->app->bind(InventoryAllocator::class);
        $this->app->forgetInstance(SettleOrder::class);

        $this->pay($buyer, $order)->assertOk()->assertJsonPath('data.status', 'paid')->assertJsonCount(2, 'data.items.0.keys');
        $this->assertDatabaseCount('simulated_charges', 1);
        $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
    }

    public function test_an_order_missing_a_key_it_was_paid_for_is_never_marked_paid(): void
    {
        Exceptions::fake();
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);
        $order = $this->pendingOrder($buyer, $offer, 2);

        // Cannot happen through the application; forced here to prove the
        // guard: someone edits the database and takes one held key away.
        $order->items->first()->licenseKeys()->limit(1)->update(['status' => 'available', 'order_item_id' => null, 'reserved_until' => null]);

        $this->pay($buyer, $order)->assertStatus(500);

        $order->refresh();
        $this->assertSame(OrderStatus::Pending, $order->status);
        $this->assertSame(0, $this->keys($offer)['sold']);
    }

    public function test_one_order_that_cannot_be_settled_does_not_block_the_others_or_the_visitor(): void
    {
        Exceptions::fake();
        $offer = $this->offer(1000, keys: 2);
        $stuck = $this->pendingOrder(User::factory()->create(), $offer);
        $fine = $this->pendingOrder(User::factory()->create(), $offer);
        auth()->forgetGuards();

        // The provider is unreachable for one particular order.
        $this->app->bind(PaymentGateway::class, fn () => new class($stuck->public_id) extends SimulatedPaymentGateway
        {
            public function __construct(private string $unreachableFor) {}

            public function cancel(string $reference): ChargeResult
            {
                if ($reference === $this->unreachableFor) {
                    throw new RuntimeException('The payment provider did not answer.');
                }

                return parent::cancel($reference);
            }
        });

        $this->passTheDeadline();

        $this->getJson('/api/products')->assertOk();

        $this->assertSame(OrderStatus::Expired, $fine->fresh()->status);
        $this->assertSame(OrderStatus::Pending, $stuck->fresh()->status);
        // The stuck order keeps its key: it is not known that no money moved.
        $this->assertSame(['available' => 1, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
        Exceptions::assertReported(RuntimeException::class);
    }

    public function test_the_expiry_command_settles_overdue_orders_only(): void
    {
        $offer = $this->offer(1000, keys: 3);
        $old = $this->pendingOrder(User::factory()->create(), $offer);
        $this->travel(6)->minutes();
        $recent = $this->pendingOrder(User::factory()->create(), $offer);
        $this->travel(5)->minutes();

        $this->artisan('orders:expire')->expectsOutput('1 overdue orders settled.')->assertSuccessful();

        $this->assertSame(OrderStatus::Expired, $old->fresh()->status);
        $this->assertSame(OrderStatus::Pending, $recent->fresh()->status);
        $this->assertSame(['available' => 2, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
    }

    public function test_settling_an_order_twice_changes_nothing_the_second_time(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);
        $order = $this->pendingOrder($buyer, $offer, 2);
        $settle = $this->app->make(SettleOrder::class);
        $salesBefore = $offer->product->sales_count;

        // Both callers still hold the order as "pending", as two requests
        // arriving together would.
        $stale = Order::findOrFail($order->id);
        $settle->pay($order, 'test_card_approved');
        $settle->pay($stale, 'test_card_approved');
        $settle->cancel(Order::findOrFail($order->id)->setAttribute('status', OrderStatus::Pending));

        $this->assertSame(OrderStatus::Paid, $order->fresh()->status);
        $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
        $this->assertSame($salesBefore + 2, $offer->product->fresh()->sales_count);
    }
}
