<?php

namespace Tests\Feature\Checkout;

use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Seller;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsCheckouts;
use Tests\TestCase;

/**
 * POST /api/cart/quote: the browser sends offer ids and quantities, the
 * server says what that cart is worth and what is wrong with it.
 */
class CartQuoteTest extends TestCase
{
    use BuildsCheckouts, RefreshDatabase;

    /** @param list<array<string, mixed>> $items */
    private function quote(array $items)
    {
        return $this->postJson('/api/cart/quote', ['items' => $items]);
    }

    public function test_a_guest_gets_names_sellers_and_prices_from_the_database(): void
    {
        $seller = Seller::factory()->create(['name' => 'KeyHive', 'slug' => 'keyhive', 'rating_percent' => 98.5, 'sales_count' => 1200]);
        $offer = $this->offer(2000, keys: 5, attributes: ['seller_id' => $seller->id, 'original_price_cents' => 2500]);

        // The browser claims nothing about the price or the name.
        $this->quote([['offer_id' => $offer->id, 'quantity' => 2]])
            ->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonPath('data.lines.0', [
                'offer_id' => $offer->id,
                'requested_quantity' => 2,
                'quantity' => 2,
                'max_quantity' => 5,
                'product' => [
                    'slug' => $offer->product->slug,
                    'name' => $offer->product->name,
                    'cover_image_url' => $offer->product->game->cover_image_url,
                    'platform' => ['slug' => $offer->product->platform->slug, 'name' => $offer->product->platform->name],
                    'region' => ['slug' => $offer->product->region->slug, 'name' => $offer->product->region->name],
                ],
                'seller' => ['slug' => 'keyhive', 'name' => 'KeyHive', 'rating_percent' => 98.5, 'sales_count' => 1200],
                'unit_price' => ['amount_cents' => 2000, 'currency' => 'EUR', 'original_amount_cents' => 2500, 'discount_percent' => 20],
                'line_total_cents' => 4000,
                'issues' => [],
            ])
            ->assertJsonPath('data.totals', [
                'items_count' => 2,
                'subtotal_cents' => 5000,
                'discount_cents' => 1000,
                'total_cents' => 4000,
                'currency' => 'EUR',
            ]);
    }

    public function test_the_same_offer_listed_twice_becomes_one_line(): void
    {
        $offer = $this->offer(1000, keys: 20);

        $this->quote([
            ['offer_id' => $offer->id, 'quantity' => 2],
            ['offer_id' => $offer->id, 'quantity' => 3],
        ])->assertOk()
            ->assertJsonCount(1, 'data.lines')
            ->assertJsonPath('data.lines.0.quantity', 5)
            ->assertJsonPath('data.totals.total_cents', 5000);

    }

    public function test_one_order_holds_at_most_ten_of_an_offer(): void
    {
        $offer = $this->offer(1000, keys: 20);

        // Asked for outright, or as two entries that add up to too many.
        foreach ([[['offer_id' => $offer->id, 'quantity' => 14]], [['offer_id' => $offer->id, 'quantity' => 7], ['offer_id' => $offer->id, 'quantity' => 7]]] as $items) {
            $this->quote($items)->assertOk()
                ->assertJsonPath('data.ok', false)
                ->assertJsonPath('data.lines.0.issues', ['quantity_limited'])
                ->assertJsonPath('data.lines.0.requested_quantity', 14)
                ->assertJsonPath('data.lines.0.quantity', 10)
                ->assertJsonPath('data.totals.total_cents', 10_000);
        }
    }

    public function test_two_sellers_of_the_same_product_are_two_lines(): void
    {
        $cheap = $this->offer(1000);
        $dear = Offer::factory()->for($cheap->product)->create(['price_cents' => 1400]);
        LicenseKey::factory()->for($dear)->create();

        $this->quote([['offer_id' => $cheap->id, 'quantity' => 1], ['offer_id' => $dear->id, 'quantity' => 1]])
            ->assertOk()
            ->assertJsonCount(2, 'data.lines')
            ->assertJsonPath('data.totals.total_cents', 2400);
    }

    public function test_offers_that_cannot_be_bought_are_marked_unavailable(): void
    {
        $soldOut = $this->offer(1000, keys: 0);
        $switchedOff = $this->offer(1000, keys: 3, attributes: ['is_active' => false]);
        $fine = $this->offer(700);

        $response = $this->quote([
            ['offer_id' => $soldOut->id, 'quantity' => 1],
            ['offer_id' => $switchedOff->id, 'quantity' => 1],
            ['offer_id' => 999_999, 'quantity' => 1],
            ['offer_id' => $fine->id, 'quantity' => 1],
        ])->assertOk()->assertJsonPath('data.ok', false);

        $lines = collect($response->json('data.lines'))->keyBy('offer_id');

        foreach ([$soldOut->id, $switchedOff->id, 999_999] as $id) {
            $this->assertSame(['unavailable'], $lines[$id]['issues']);
            $this->assertSame(0, $lines[$id]['quantity']);
            $this->assertSame(0, $lines[$id]['line_total_cents']);
        }
        // An offer that still exists can be named; one that never did cannot.
        $this->assertSame($soldOut->product->name, $lines[$soldOut->id]['product']['name']);
        $this->assertNull($lines[999_999]['product']);
        $this->assertSame([], $lines[$fine->id]['issues']);
        // Only what can be bought is counted.
        $response->assertJsonPath('data.totals.total_cents', 700)->assertJsonPath('data.totals.items_count', 1);
    }

    public function test_asking_for_more_than_is_in_stock_is_reduced_to_what_is_left(): void
    {
        $offer = $this->offer(1000, keys: 2);

        $this->quote([['offer_id' => $offer->id, 'quantity' => 5]])
            ->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.lines.0.issues', ['insufficient_stock'])
            ->assertJsonPath('data.lines.0.requested_quantity', 5)
            ->assertJsonPath('data.lines.0.quantity', 2)
            ->assertJsonPath('data.lines.0.max_quantity', 2)
            ->assertJsonPath('data.totals.total_cents', 2000);
    }

    public function test_a_price_different_from_the_one_the_buyer_saw_is_flagged(): void
    {
        $offer = $this->offer(1500);

        $this->quote([$this->item($offer, 1, shownPriceCents: 1200)])
            ->assertOk()
            ->assertJsonPath('data.ok', false)
            ->assertJsonPath('data.lines.0.issues', ['price_changed'])
            // The total is always at the real price.
            ->assertJsonPath('data.lines.0.unit_price.amount_cents', 1500)
            ->assertJsonPath('data.totals.total_cents', 1500);

        $this->quote([$this->item($offer, 1, shownPriceCents: 1500)])->assertJsonPath('data.ok', true);
    }

    public function test_keys_held_for_another_buyer_do_not_count_as_stock(): void
    {
        $offer = $this->offer(1000, keys: 3);
        $this->pendingOrder(User::factory()->create(), $offer, 2);
        auth()->forgetGuards();

        $this->quote([['offer_id' => $offer->id, 'quantity' => 3]])
            ->assertJsonPath('data.lines.0.quantity', 1)
            ->assertJsonPath('data.lines.0.issues', ['insufficient_stock']);
    }

    public function test_keys_held_by_the_buyers_own_unpaid_order_still_count_for_that_buyer(): void
    {
        // The last key, held by the buyer's own checkout in progress.
        $offer = $this->offer(1000, keys: 1);
        $buyer = User::factory()->create();
        $order = $this->pendingOrder($buyer, $offer);

        // Back at the cart, it is still theirs to buy...
        $this->actingAs($buyer)->postJson('/api/cart/quote', ['items' => [$this->item($offer)]])
            ->assertOk()
            ->assertJsonPath('data.ok', true)
            ->assertJsonPath('data.lines.0.max_quantity', 1);

        // ...and checking out again with the same cart continues that order.
        $this->placeOrder($buyer, [$this->item($offer)], $order->idempotency_key)->assertOk()->assertJsonPath('data.id', $order->public_id);

        // Anyone else sees it as taken.
        $this->actingAs(User::factory()->create())->postJson('/api/cart/quote', ['items' => [$this->item($offer)]])
            ->assertJsonPath('data.lines.0.issues', ['unavailable']);
        auth()->forgetGuards();
        $this->quote([$this->item($offer)])->assertJsonPath('data.lines.0.issues', ['unavailable']);
    }

    public function test_keys_the_buyer_already_paid_for_do_not_count_as_stock_again(): void
    {
        $offer = $this->offer(1000, keys: 1);
        $buyer = User::factory()->create();
        $this->pay($buyer, $this->pendingOrder($buyer, $offer))->assertOk();

        $this->actingAs($buyer)->postJson('/api/cart/quote', ['items' => [$this->item($offer)]])
            ->assertJsonPath('data.lines.0.issues', ['unavailable']);
    }

    public function test_keys_of_an_unpaid_order_are_back_in_stock_once_its_time_is_up(): void
    {
        $offer = $this->offer(1000, keys: 1);
        $this->pendingOrder(User::factory()->create(), $offer);
        auth()->forgetGuards();

        $this->quote([['offer_id' => $offer->id, 'quantity' => 1]])->assertJsonPath('data.lines.0.issues', ['unavailable']);

        $this->travel(config('checkout.reservation_minutes') + 1)->minutes();

        $this->quote([['offer_id' => $offer->id, 'quantity' => 1]])->assertJsonPath('data.ok', true);
    }

    public function test_the_exact_stock_is_not_revealed_beyond_the_limit_per_line(): void
    {
        $offer = $this->offer(1000, keys: 37);

        $this->quote([['offer_id' => $offer->id, 'quantity' => 1]])->assertJsonPath('data.lines.0.max_quantity', 10);
    }

    public function test_a_quote_never_contains_a_license_key(): void
    {
        $offer = $this->offer(1000, keys: 3);

        $body = $this->quote([['offer_id' => $offer->id, 'quantity' => 3]])->assertOk()->getContent();

        foreach (LicenseKey::pluck('code') as $code) {
            $this->assertStringNotContainsString($code, $body);
        }
    }

    public function test_a_malformed_cart_is_rejected(): void
    {
        $offer = $this->offer();

        $this->postJson('/api/cart/quote', [])->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->quote([])->assertUnprocessable()->assertJsonValidationErrors('items');
        $this->quote([['offer_id' => $offer->id, 'quantity' => 0]])->assertUnprocessable()->assertJsonValidationErrors('items.0.quantity');
        $this->quote([['offer_id' => $offer->id, 'quantity' => 1001]])->assertUnprocessable()->assertJsonValidationErrors('items.0.quantity');
        $this->quote([['offer_id' => $offer->id, 'quantity' => '2 OR 1=1']])->assertUnprocessable();
        $this->quote([['offer_id' => 'abc', 'quantity' => 1]])->assertUnprocessable()->assertJsonValidationErrors('items.0.offer_id');
        $this->quote([['offer_id' => $offer->id]])->assertUnprocessable()->assertJsonValidationErrors('items.0.quantity');
        $this->quote([['offer_id' => $offer->id, 'quantity' => 1, 'unit_price_cents' => -5]])->assertUnprocessable();
        // A field the API does not know: refused rather than ignored.
        $this->quote([['offer_id' => $offer->id, 'quantity' => 1, 'price_override' => 1]])->assertUnprocessable();
        // More lines than a cart may have.
        $this->quote(array_fill(0, 21, ['offer_id' => $offer->id, 'quantity' => 1]))->assertUnprocessable()->assertJsonValidationErrors('items');
    }
}
