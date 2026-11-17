<?php

namespace Tests\Feature\Checkout;

use App\Enums\OrderStatus;
use App\Models\LicenseKey;
use App\Models\Order;
use App\Models\User;
use App\Services\Checkout\CartChanged;
use App\Services\Checkout\PlaceOrder;
use App\Services\Checkout\SettleOrder;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Concerns\BuildsCheckouts;
use Tests\Concerns\RunsInParallel;
use Tests\TestCase;

/**
 * Several buyers, or several copies of one request, at the same instant.
 * Each runs in its own process with its own database connection (see
 * RunsInParallel), so these are real races, not simulated ones.
 */
class CheckoutConcurrencyTest extends TestCase
{
    use BuildsCheckouts, DatabaseMigrations, RunsInParallel;

    /** Place an order in the current process; report what happened. */
    private function tryToPlace(int $userId, array $items, string $idempotencyKey): array
    {
        try {
            $order = app(PlaceOrder::class)->handle(User::findOrFail($userId), $items, $idempotencyKey);

            return ['order' => $order->public_id, 'created' => $order->wasRecentlyCreated];
        } catch (CartChanged) {
            return ['order' => null, 'cart_changed' => true];
        }
    }

    public function test_eight_buyers_racing_for_three_keys_get_three_orders_and_no_key_twice(): void
    {
        $offer = $this->offer(1000, keys: 3);
        $buyers = User::factory()->count(8)->create();

        $results = $this->inParallel($buyers->map(fn (User $buyer) => fn () => $this->tryToPlace(
            $buyer->id, [$this->item($offer)], (string) Str::uuid(),
        ))->all());

        $won = array_filter($results, fn (array $result) => ($result['order'] ?? null) !== null);
        $lost = array_filter($results, fn (array $result) => $result['cart_changed'] ?? false);

        $this->assertCount(3, $won, json_encode($results));
        $this->assertCount(5, $lost, json_encode($results));
        $this->assertSame(3, Order::count());
        $this->assertSame(['available' => 0, 'reserved' => 3, 'sold' => 0], $this->keys($offer));
        // Three keys, three different order lines, three different buyers.
        $this->assertSame(3, LicenseKey::distinct()->count('order_item_id'));
        $this->assertSame(3, Order::distinct()->count('user_id'));
    }

    public function test_the_last_key_goes_to_exactly_one_of_two_buyers_who_then_gets_it(): void
    {
        $offer = $this->offer(1000, keys: 1);
        [$anna, $ben] = User::factory()->count(2)->create()->all();

        $results = $this->inParallel([
            fn () => $this->tryToPlace($anna->id, [$this->item($offer)], (string) Str::uuid()),
            fn () => $this->tryToPlace($ben->id, [$this->item($offer)], (string) Str::uuid()),
        ]);

        $this->assertCount(1, array_filter(array_column($results, 'order')), json_encode($results));
        $order = Order::sole();

        app(SettleOrder::class)->pay($order, 'test_card_approved');

        $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 1], $this->keys($offer));
        $this->assertSame($order->items()->sole()->id, LicenseKey::sole()->order_item_id);
    }

    public function test_the_same_request_sent_six_times_at_once_creates_one_order(): void
    {
        // Exactly as many keys as the order needs: a copy that lost the race
        // finds none left, and must still answer with the one order.
        $offer = $this->offer(1000, keys: 2);
        $buyer = User::factory()->create();
        $key = (string) Str::uuid();

        $results = $this->inParallel(array_fill(0, 6, fn () => $this->tryToPlace($buyer->id, [$this->item($offer, 2)], $key)));

        $this->assertSame(1, Order::count(), json_encode($results));
        // Every copy of the request got the same order back...
        $this->assertSame([Order::sole()->public_id], array_values(array_unique(array_column($results, 'order'))), json_encode($results));
        // ...exactly one of them created it...
        $this->assertCount(1, array_filter(array_column($results, 'created')));
        // ...and its keys were held once.
        $this->assertSame(['available' => 0, 'reserved' => 2, 'sold' => 0], $this->keys($offer));
        $this->assertSame(OrderStatus::Pending, Order::sole()->status);
    }

    public function test_pay_pressed_six_times_at_once_charges_once_and_delivers_once(): void
    {
        $offer = $this->offer(1000, keys: 5);
        $buyer = User::factory()->create();
        $order = app(PlaceOrder::class)->handle($buyer, [$this->item($offer, 2)], (string) Str::uuid());
        $salesBefore = $offer->product->sales_count;
        $sellerSalesBefore = $offer->seller->sales_count;

        $results = $this->inParallel(array_fill(0, 6, fn () => app(SettleOrder::class)
            ->pay(Order::findOrFail($order->id), 'test_card_approved')->status->value));

        $this->assertSame(array_fill(0, 6, 'paid'), $results);
        $this->assertSame(1, DB::table('simulated_charges')->count());
        $this->assertSame(['available' => 3, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
        $this->assertSame($salesBefore + 2, $offer->product->fresh()->sales_count);
        $this->assertSame($sellerSalesBefore + 2, $offer->seller->fresh()->sales_count);
    }

    public function test_paying_and_cancelling_at_the_same_moment_ends_one_way_or_the_other_never_both(): void
    {
        // Repeated, because which side wins is decided by timing.
        foreach (range(1, 4) as $round) {
            $offer = $this->offer(1000, keys: 2);
            $buyer = User::factory()->create();
            $order = app(PlaceOrder::class)->handle($buyer, [$this->item($offer, 2)], (string) Str::uuid());

            $pay = fn () => app(SettleOrder::class)->pay(Order::findOrFail($order->id), 'test_card_approved')->status->value;
            $cancel = fn () => app(SettleOrder::class)->cancel(Order::findOrFail($order->id))->status->value;

            $results = $this->inParallel([$pay, $cancel, $pay, $cancel, $pay, $cancel]);

            $order->refresh();
            $charge = $this->charge($order);

            // Every process reports the same final state.
            $this->assertCount(1, array_unique($results), "round {$round}: ".json_encode($results));
            $this->assertSame($order->status->value, $results[0]);

            if ($charge === 'succeeded') {
                // The charge won: the buyer has the keys and paid for them.
                $this->assertSame(OrderStatus::Paid, $order->status);
                $this->assertSame(['available' => 0, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
            } else {
                // The cancellation won: no money moved and no key was sold.
                $this->assertSame('cancelled', $charge);
                $this->assertSame(OrderStatus::Cancelled, $order->status);
                $this->assertSame(['available' => 2, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
            }
        }
    }

    public function test_buyers_taking_the_same_two_offers_in_opposite_order_do_not_block_each_other(): void
    {
        $first = $this->offer(1000, keys: 10);
        $second = $this->offer(2000, keys: 10);
        $buyers = User::factory()->count(6)->create();

        $results = $this->inParallel($buyers->values()->map(fn (User $buyer, int $index) => fn () => $this->tryToPlace(
            $buyer->id,
            $index % 2 === 0 ? [$this->item($first), $this->item($second)] : [$this->item($second), $this->item($first)],
            (string) Str::uuid(),
        ))->all());

        // No deadlock, no error: everyone got an order.
        $this->assertCount(6, array_filter(array_column($results, 'order')), json_encode($results));
        $this->assertSame(['available' => 4, 'reserved' => 6, 'sold' => 0], $this->keys($first));
        $this->assertSame(['available' => 4, 'reserved' => 6, 'sold' => 0], $this->keys($second));
    }

    public function test_a_buyer_starting_two_checkouts_at_once_never_holds_a_key_twice(): void
    {
        $offer = $this->offer(1000, keys: 1);
        $buyer = User::factory()->create();

        $results = $this->inParallel([
            fn () => $this->tryToPlace($buyer->id, [$this->item($offer)], (string) Str::uuid()),
            fn () => $this->tryToPlace($buyer->id, [$this->item($offer)], (string) Str::uuid()),
        ]);

        $this->assertCount(1, array_filter(array_column($results, 'order')), json_encode($results));
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
    }
}
