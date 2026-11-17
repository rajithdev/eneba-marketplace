<?php

namespace Tests\Feature\Checkout;

use App\Enums\LicenseKeyStatus;
use App\Enums\OrderStatus;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Order;
use App\Models\Seller;
use App\Models\User;
use App\Services\Checkout\InventoryAllocator;
use App\Services\Checkout\PlaceOrder;
use App\Services\Checkout\QuoteCart;
use App\Services\Checkout\SettleOrder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\Concerns\BuildsCheckouts;
use Tests\TestCase;

/** POST /api/orders: hold the keys and create a pending order. */
class PlaceOrderTest extends TestCase
{
    use BuildsCheckouts, RefreshDatabase;

    public function test_a_signed_out_visitor_cannot_place_an_order(): void
    {
        $offer = $this->offer();

        $this->postJson('/api/orders', ['items' => [$this->item($offer)]], ['Idempotency-Key' => (string) Str::uuid()])
            ->assertUnauthorized();

        $this->assertSame(0, Order::count());
        $this->assertSame(['available' => 3, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_it_holds_exactly_the_keys_asked_for_and_creates_a_pending_order(): void
    {
        $this->freezeSecond();
        $buyer = User::factory()->create();
        $offer = $this->offer(1250, keys: 5);

        $response = $this->placeOrder($buyer, [$this->item($offer, 2)])
            ->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonPath('data.totals.total_cents', 2500)
            ->assertJsonPath('data.totals.items_count', 2)
            ->assertJsonPath('data.payment', ['status' => 'pending', 'method' => null])
            ->assertJsonPath('data.expires_in_seconds', 600)
            ->assertJsonPath('data.paid_at', null)
            // Held, but not the buyer's yet: no key is shown.
            ->assertJsonPath('data.items.0.keys', [])
            ->assertJsonCount(3, 'data.payment_methods');

        $order = Order::where('public_id', $response->json('data.id'))->firstOrFail();
        $this->assertSame($buyer->id, $order->user_id);
        $this->assertTrue($order->expires_at->equalTo(now()->addMinutes(10)));

        $this->assertSame(['available' => 3, 'reserved' => 2, 'sold' => 0], $this->keys($offer));
        $held = LicenseKey::where('status', LicenseKeyStatus::Reserved)->get();
        $this->assertSame([$order->items->first()->id], $held->pluck('order_item_id')->unique()->all());
        $this->assertTrue($held->every(fn (LicenseKey $key) => $key->reserved_until->equalTo($order->expires_at)));

        foreach (LicenseKey::pluck('code') as $code) {
            $this->assertStringNotContainsString($code, $response->getContent());
        }
    }

    public function test_the_order_line_records_the_offer_as_it_was_bought(): void
    {
        $seller = Seller::factory()->create(['name' => 'KeyHive']);
        $offer = $this->offer(2000, attributes: ['seller_id' => $seller->id, 'original_price_cents' => 2500]);
        $buyer = User::factory()->create();

        $this->placeOrder($buyer, [$this->item($offer)])->assertCreated()
            ->assertJsonPath('data.items.0.seller_name', 'KeyHive')
            ->assertJsonPath('data.items.0.product.name', $offer->product->name)
            ->assertJsonPath('data.items.0.unit_price', ['amount_cents' => 2000, 'currency' => 'EUR', 'original_amount_cents' => 2500, 'discount_percent' => 20])
            ->assertJsonPath('data.totals', ['items_count' => 1, 'subtotal_cents' => 2500, 'discount_cents' => 500, 'total_cents' => 2000, 'currency' => 'EUR']);

        // Later changes to the catalog do not rewrite the order.
        $offer->update(['price_cents' => 9900, 'original_price_cents' => null]);
        $seller->update(['name' => 'Renamed']);
        $offer->product->update(['name' => 'Renamed product']);
        $id = Order::firstOrFail()->public_id;

        $this->actingAs($buyer)->getJson("/api/orders/{$id}")->assertOk()
            ->assertJsonPath('data.items.0.seller_name', 'KeyHive')
            ->assertJsonPath('data.items.0.unit_price.amount_cents', 2000)
            ->assertJsonPath('data.totals.total_cents', 2000);
    }

    public function test_repeating_the_same_request_returns_the_same_order_and_holds_nothing_more(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 5);
        $key = (string) Str::uuid();

        $first = $this->placeOrder($buyer, [$this->item($offer, 2)], $key)->assertCreated();
        $again = $this->placeOrder($buyer, [$this->item($offer, 2)], $key)->assertOk();
        $third = $this->placeOrder($buyer, [$this->item($offer, 2)], $key)->assertOk();

        $this->assertSame($first->json('data.id'), $again->json('data.id'));
        $this->assertSame($first->json('data.id'), $third->json('data.id'));
        $this->assertSame(1, Order::count());
        $this->assertSame(['available' => 3, 'reserved' => 2, 'sold' => 0], $this->keys($offer));
    }

    public function test_a_repeat_still_returns_the_order_after_it_was_paid(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);
        $key = (string) Str::uuid();

        $id = $this->placeOrder($buyer, [$this->item($offer)], $key)->assertCreated()->json('data.id');
        $this->pay($buyer, $id)->assertOk();

        $this->placeOrder($buyer, [$this->item($offer)], $key)->assertOk()
            ->assertJsonPath('data.id', $id)
            ->assertJsonPath('data.status', 'paid');
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 1], $this->keys($offer));
    }

    public function test_reusing_a_key_for_a_different_cart_is_refused(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 5);
        $key = (string) Str::uuid();

        $this->placeOrder($buyer, [$this->item($offer, 1)], $key)->assertCreated();

        $this->placeOrder($buyer, [$this->item($offer, 3)], $key)
            ->assertUnprocessable()
            ->assertJsonPath('code', 'idempotency_key_reused');

        $this->assertSame(1, Order::count());
        $this->assertSame(['available' => 4, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
    }

    public function test_the_same_key_from_two_buyers_gives_two_orders(): void
    {
        $offer = $this->offer(1000, keys: 5);
        $key = (string) Str::uuid();

        $one = $this->placeOrder(User::factory()->create(), [$this->item($offer)], $key)->assertCreated()->json('data.id');
        $two = $this->placeOrder(User::factory()->create(), [$this->item($offer)], $key)->assertCreated()->json('data.id');

        $this->assertNotSame($one, $two);
    }

    public function test_the_idempotency_key_header_is_required_and_checked(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer();
        $body = ['items' => [$this->item($offer)]];

        $this->actingAs($buyer)->postJson('/api/orders', $body)->assertUnprocessable()->assertJsonValidationErrors('idempotency_key');
        $this->actingAs($buyer)->postJson('/api/orders', $body, ['Idempotency-Key' => 'short'])->assertUnprocessable();
        $this->actingAs($buyer)->postJson('/api/orders', $body, ['Idempotency-Key' => "abc'; DROP TABLE orders; --"])->assertUnprocessable();
        // It cannot be supplied in the body instead.
        $this->actingAs($buyer)->postJson('/api/orders', [...$body, 'idempotency_key' => (string) Str::uuid()])->assertUnprocessable();

        $this->assertSame(0, Order::count());
    }

    public function test_a_changed_price_stops_the_order_and_reports_the_new_one(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1500, keys: 3);

        $this->placeOrder($buyer, [$this->item($offer, 1, shownPriceCents: 1200)])
            ->assertConflict()
            ->assertJsonPath('code', 'cart_changed')
            ->assertJsonPath('quote.lines.0.issues', ['price_changed'])
            ->assertJsonPath('quote.lines.0.unit_price.amount_cents', 1500);

        $this->assertSame(0, Order::count());
        $this->assertSame(['available' => 3, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_the_price_the_buyer_saw_must_be_sent(): void
    {
        $offer = $this->offer();

        $this->placeOrder(User::factory()->create(), [['offer_id' => $offer->id, 'quantity' => 1]])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('items.0.unit_price_cents');
    }

    public function test_too_little_stock_stops_the_order_and_reports_what_is_left(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 2);

        $this->placeOrder($buyer, [$this->item($offer, 3)])
            ->assertConflict()
            ->assertJsonPath('code', 'cart_changed')
            ->assertJsonPath('quote.lines.0.issues', ['insufficient_stock'])
            ->assertJsonPath('quote.lines.0.quantity', 2);

        $this->assertSame(0, Order::count());
        $this->assertSame(['available' => 2, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_an_offer_that_was_switched_off_or_sold_out_stops_the_order(): void
    {
        $buyer = User::factory()->create();
        $switchedOff = $this->offer(1000, attributes: ['is_active' => false]);
        $soldOut = $this->offer(1000, keys: 0);

        foreach ([$switchedOff, $soldOut] as $offer) {
            $this->placeOrder($buyer, [$this->item($offer)])
                ->assertConflict()
                ->assertJsonPath('quote.lines.0.issues', ['unavailable']);
        }
        $this->placeOrder($buyer, [['offer_id' => 999_999, 'quantity' => 1, 'unit_price_cents' => 100]])->assertConflict();

        $this->assertSame(0, Order::count());
    }

    public function test_an_order_cannot_hold_more_of_an_offer_than_the_limit(): void
    {
        $offer = $this->offer(1000, keys: 20);

        $this->placeOrder(User::factory()->create(), [$this->item($offer, 11)])
            ->assertConflict()
            ->assertJsonPath('quote.lines.0.issues', ['quantity_limited'])
            ->assertJsonPath('quote.lines.0.quantity', 10);

        $this->assertSame(0, Order::count());
        $this->assertSame(['available' => 20, 'reserved' => 0, 'sold' => 0], $this->keys($offer));
    }

    public function test_an_order_is_all_or_nothing_across_its_lines(): void
    {
        $buyer = User::factory()->create();
        $plenty = $this->offer(1000, keys: 5);
        $scarce = $this->offer(2000, keys: 1);

        $this->placeOrder($buyer, [$this->item($plenty, 2), $this->item($scarce, 2)])->assertConflict();

        $this->assertSame(0, Order::count());
        $this->assertSame(['available' => 5, 'reserved' => 0, 'sold' => 0], $this->keys($plenty));
        $this->assertSame(['available' => 1, 'reserved' => 0, 'sold' => 0], $this->keys($scarce));
    }

    public function test_an_order_can_hold_offers_from_several_sellers(): void
    {
        $buyer = User::factory()->create();
        $cheap = $this->offer(1000, keys: 2);
        $otherSeller = Offer::factory()->for($cheap->product)->create(['price_cents' => 1400]);
        LicenseKey::factory()->count(2)->for($otherSeller)->create();

        $this->placeOrder($buyer, [$this->item($cheap, 2), $this->item($otherSeller, 1)])
            ->assertCreated()
            ->assertJsonCount(2, 'data.items')
            ->assertJsonPath('data.totals.total_cents', 3400);

        $this->assertSame(['available' => 0, 'reserved' => 2, 'sold' => 0], $this->keys($cheap));
        $this->assertSame(['available' => 1, 'reserved' => 1, 'sold' => 0], $this->keys($otherSeller));
    }

    public function test_the_same_offer_listed_twice_becomes_one_order_line(): void
    {
        $offer = $this->offer(1000, keys: 5);

        $this->placeOrder(User::factory()->create(), [$this->item($offer, 1), $this->item($offer, 2)])
            ->assertCreated()
            ->assertJsonCount(1, 'data.items')
            ->assertJsonPath('data.items.0.quantity', 3)
            ->assertJsonPath('data.totals.total_cents', 3000);

        $this->assertSame(['available' => 2, 'reserved' => 3, 'sold' => 0], $this->keys($offer));
    }

    public function test_starting_another_checkout_gives_up_the_earlier_one(): void
    {
        $buyer = User::factory()->create();
        // The last key: without this rule the buyer's own abandoned order
        // would make it look sold out to them.
        $offer = $this->offer(1000, keys: 1);

        $first = $this->pendingOrder($buyer, $offer);
        $second = $this->pendingOrder($buyer, $offer);

        $this->assertSame(OrderStatus::Cancelled, $first->fresh()->status);
        $this->assertSame('cancelled', $this->charge($first));
        $this->assertSame(OrderStatus::Pending, $second->fresh()->status);
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
        $this->assertSame($second->items->first()->id, LicenseKey::firstOrFail()->order_item_id);
    }

    public function test_a_copy_of_a_request_never_cancels_the_order_its_twin_just_created(): void
    {
        $buyer = User::factory()->create();
        $offer = $this->offer(1000, keys: 1);
        $key = (string) Str::uuid();
        $first = $this->placeOrder($buyer, [$this->item($offer)], $key)->assertCreated()->json('data.id');

        // The second copy of the request looked for the order a moment
        // before the first copy saved it, so its first look finds nothing.
        $this->app->bind(PlaceOrder::class, fn ($app) => new class($app->make(QuoteCart::class), $app->make(InventoryAllocator::class), $app->make(SettleOrder::class)) extends PlaceOrder
        {
            private bool $looked = false;

            protected function find(User $user, string $idempotencyKey): ?Order
            {
                if (! $this->looked) {
                    $this->looked = true;

                    return null;
                }

                return parent::find($user, $idempotencyKey);
            }
        });

        $this->placeOrder($buyer, [$this->item($offer)], $key)
            ->assertOk()
            ->assertJsonPath('data.id', $first)
            ->assertJsonPath('data.status', 'pending');

        $this->assertSame(1, Order::count());
        $this->assertNull($this->charge(Order::firstOrFail()));
        $this->assertSame(['available' => 0, 'reserved' => 1, 'sold' => 0], $this->keys($offer));
    }

    public function test_another_buyers_pending_order_is_left_alone(): void
    {
        $offer = $this->offer(1000, keys: 2);

        $first = $this->pendingOrder(User::factory()->create(), $offer);
        $this->pendingOrder(User::factory()->create(), $offer);

        $this->assertSame(OrderStatus::Pending, $first->fresh()->status);
        $this->assertSame(['available' => 0, 'reserved' => 2, 'sold' => 0], $this->keys($offer));
    }
}
