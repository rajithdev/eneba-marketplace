<?php

namespace Tests\Feature\Checkout;

use App\Enums\OrderStatus;
use App\Models\LicenseKey;
use App\Models\Order;
use App\Models\Product;
use App\Models\Seller;
use App\Models\User;
use App\Services\Checkout\CartChanged;
use App\Services\Checkout\CheckoutInProgress;
use App\Services\Checkout\PaymentGateway;
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

    public function test_one_buyer_starting_six_different_checkouts_at_once_holds_keys_for_only_one(): void
    {
        // Six different offers with plenty of stock, six different
        // idempotency keys: nothing but the one-checkout-per-buyer rule
        // stands between this buyer and six orders holding keys at once.
        $offers = collect(range(1, 6))->map(fn () => $this->offer(1000, keys: 5));
        $buyer = User::factory()->create();

        $results = $this->inParallel($offers->map(fn ($offer) => fn () => $this->tryToPlace(
            $buyer->id, [$this->item($offer, 2)], (string) Str::uuid(),
        ))->all());

        // However the six interleaved, one order is left holding keys.
        $pending = Order::where('status', OrderStatus::Pending)->get();
        $this->assertCount(1, $pending, json_encode($results));
        $this->assertSame(2, LicenseKey::where('status', 'reserved')->count(), json_encode($results));
        $this->assertSame(2, LicenseKey::where('status', 'reserved')->whereIn('order_item_id', $pending->first()->items()->pluck('id'))->count());
        $this->assertSame(28, LicenseKey::where('status', 'available')->count());

        // Each request either got an order (which a later one may have
        // cancelled, as starting a new checkout always does) or was told
        // to try again. None failed in an uncontrolled way.
        foreach ($results as $result) {
            $this->assertTrue(
                isset($result['order']) || ($result['exception'] ?? null) === CheckoutInProgress::class,
                json_encode($results),
            );
        }
        $this->assertContains($pending->first()->public_id, array_column($results, 'order'));
        $this->assertSame(0, Order::whereNotIn('status', [OrderStatus::Pending, OrderStatus::Cancelled])->count());
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

    public function test_a_charged_order_opened_in_six_tabs_at_once_is_completed_once(): void
    {
        $offer = $this->offer(1000, keys: 3);
        $buyer = User::factory()->create();
        $order = app(PlaceOrder::class)->handle($buyer, [$this->item($offer, 2)], (string) Str::uuid());
        $salesBefore = $offer->product->sales_count;
        // Charged at the provider, never recorded: the crash this recovers from.
        app(PaymentGateway::class)->charge($order->public_id, $order->total_cents, 'EUR', 'test_card_approved');

        $results = $this->inParallel(array_fill(0, 6, fn () => app(SettleOrder::class)
            ->reconcile(Order::findOrFail($order->id))->status->value));

        $this->assertSame(array_fill(0, 6, 'paid'), $results);
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 2], $this->keys($offer));
        $this->assertSame($salesBefore + 2, $offer->product->fresh()->sales_count);
        $this->assertSame(1, DB::table('simulated_charges')->count());
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

        // The slower request gives up the order that beat it and takes its
        // place, as it would have a moment later. Either way the one key
        // is held once, by the one order still in progress.
        $this->assertSame(1, Order::where('status', OrderStatus::Pending)->count(), json_encode($results));
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
        $this->assertSame(Order::where('status', OrderStatus::Pending)->sole()->items()->sole()->id, LicenseKey::sole()->order_item_id);
    }

    public function test_adding_the_one_checkout_rule_first_gives_up_a_buyers_extra_unpaid_orders(): void
    {
        // The database as it could be just before this rule is deployed:
        // one buyer with two unpaid orders, each holding a key.
        $this->artisan('migrate:rollback', ['--step' => 1])->assertSuccessful();
        [$older, $newer] = [$this->offer(1000, keys: 1), $this->offer(2000, keys: 1)];
        [$buyer, $other] = User::factory()->count(2)->create()->all();
        $first = app(PlaceOrder::class)->handle($buyer, [$this->item($older)], (string) Str::uuid());
        $second = app(PlaceOrder::class)->handle($other, [$this->item($newer)], (string) Str::uuid());
        DB::table('orders')->where('id', $second->id)->update(['user_id' => $buyer->id]);

        $this->artisan('migrate')->assertSuccessful();

        // The newest is kept; the older one is cancelled the proper way.
        $this->assertSame(OrderStatus::Cancelled, $first->fresh()->status);
        $this->assertSame('cancelled', $this->charge($first));
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 0], $this->keys($older));
        $this->assertSame(OrderStatus::Pending, $second->fresh()->status);
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($newer));
    }

    public function test_two_orders_sharing_sellers_and_products_in_opposite_line_order_are_both_paid(): void
    {
        // Paying raises a sales counter on each product and seller bought
        // from. Two payments that reach the same rows in opposite order
        // can each end up waiting for the other; the database then stops
        // one of them, after its buyer has been charged.
        //
        // Lines are stored in offer order. Anna's offers run through the
        // sellers and products first to last, Ben's last to first.
        $sellers = Seller::factory()->count(8)->create();
        $products = Product::factory()->count(8)->create();
        $forAnna = $sellers->map(fn (Seller $seller, int $i) => $this->offer(1000, keys: 20, attributes: ['seller_id' => $seller->id, 'product_id' => $products[$i]->id]));
        $forBen = $sellers->reverse()->values()->map(fn (Seller $seller, int $i) => $this->offer(1000, keys: 20, attributes: ['seller_id' => $seller->id, 'product_id' => $products[(14 - $i) % 8]->id]));

        // Left to chance the two payments rarely overlap, so each one
        // pauses after every counter it raises: both are then certain to
        // be in the middle of their counters at the same time.
        $payslowly = function (int $orderId) {
            DB::listen(fn ($query) => str_contains($query->sql, 'sales_count') && usleep(25_000));

            return app(SettleOrder::class)->pay(Order::findOrFail($orderId), 'test_card_approved')->status->value;
        };

        foreach (range(1, 2) as $round) {
            [$anna, $ben] = User::factory()->count(2)->create()->all();
            $annas = app(PlaceOrder::class)->handle($anna, $forAnna->map(fn ($offer) => $this->item($offer))->all(), (string) Str::uuid());
            $bens = app(PlaceOrder::class)->handle($ben, $forBen->map(fn ($offer) => $this->item($offer))->all(), (string) Str::uuid());

            $results = $this->inParallel([fn () => $payslowly($annas->id), fn () => $payslowly($bens->id)]);

            $this->assertSame(['paid', 'paid'], $results, "round {$round}: ".json_encode($results));
        }

        // Every sale was counted exactly once.
        $this->assertSame(array_fill(0, 8, 4), $sellers->map(fn (Seller $seller) => $seller->fresh()->sales_count - $seller->sales_count)->all());
        $this->assertSame(array_fill(0, 8, 4), $products->map(fn (Product $product) => $product->fresh()->sales_count - $product->sales_count)->all());
    }
}
