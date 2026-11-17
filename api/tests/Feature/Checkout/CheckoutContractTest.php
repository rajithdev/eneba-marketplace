<?php

namespace Tests\Feature\Checkout;

use App\Models\Offer;
use App\Models\Product;
use App\Models\User;
use Database\Seeders\CatalogSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\BuildsCheckouts;
use Tests\Concerns\ChecksContracts;
use Tests\TestCase;

/**
 * The cart and order example responses (see ChecksContracts): one purchase
 * of seeded products, from the cart to the delivered keys.
 */
class CheckoutContractTest extends TestCase
{
    use BuildsCheckouts, ChecksContracts, RefreshDatabase;

    private const ORDER_ID = '00000000-0000-4000-8000-000000000001';

    public function test_a_purchase_returns_exactly_its_recorded_examples(): void
    {
        $this->travelTo('2026-11-18 12:00:00');
        $this->seed(CatalogSeeder::class);
        $buyer = User::factory()->create();

        $discounted = $this->cheapestOffer('elden-ring-steam-key-global');
        $other = $this->cheapestOffer('minecraft-xbox-live-key-global');
        $items = [$this->item($discounted, 2), $this->item($other, 1)];

        // A cart with something wrong in it: the first price is no longer
        // the one the buyer was shown.
        $stale = [$this->item($discounted, 2, shownPriceCents: $discounted->price_cents + 100), $this->item($other, 1)];
        $this->assertMatchesExample('cart.quote.json', 'POST /api/cart/quote', $this->stable(
            $this->postJson('/api/cart/quote', ['items' => $stale])->assertOk()->json(),
        ));

        $changed = $this->placeOrder($buyer, [$this->item($discounted, 2, shownPriceCents: $discounted->price_cents + 100)])->assertConflict();
        $this->assertMatchesExample('orders.cart-changed.json', 'POST /api/orders (409)', $this->stable($changed->json()));

        $pending = $this->placeOrder($buyer, $items)->assertCreated();
        $id = $pending->json('data.id');
        $this->assertMatchesExample('orders.pending.json', 'POST /api/orders', $this->stable($pending->json(), $id));

        $this->travel(90)->seconds();
        $paid = $this->pay($buyer, $id)->assertOk();
        $this->assertMatchesExample('orders.paid.json', 'POST /api/orders/{id}/pay', $this->stable($paid->json(), $id));

        $declined = $this->pendingOrder($buyer, $other);
        $failed = $this->pay($buyer, $declined, 'test_card_declined')->assertStatus(402);
        $this->assertMatchesExample('orders.declined.json', 'POST /api/orders/{id}/pay (402)', $this->stable($failed->json(), $declined->public_id));

        $list = $this->actingAs($buyer)->getJson('/api/orders')->assertOk();
        $this->assertMatchesExample('orders.list.json', 'GET /api/orders', $this->stable($list->json(), $id, $declined->public_id));
    }

    private function cheapestOffer(string $productSlug): Offer
    {
        return Offer::query()->sellable()
            ->whereBelongsTo(Product::where('slug', $productSlug)->firstOrFail())
            ->orderBy('price_cents')->orderBy('id')->firstOrFail();
    }

    /**
     * Values that differ from run to run are not part of the contract: the
     * random order ids are replaced by fixed ones, and database offer ids
     * by their position in their list.
     *
     * @param  array<string, mixed>  $value
     * @return array<string, mixed>
     */
    private function stable(array $value, string ...$orderIds): array
    {
        $json = json_encode($value);

        foreach ($orderIds as $position => $orderId) {
            $json = str_replace($orderId, substr(self::ORDER_ID, 0, -1).($position + 1), $json);
        }

        return $this->withOfferPositions(json_decode($json, true));
    }

    /**
     * @param  array<string|int, mixed>  $value
     * @return array<string|int, mixed>
     */
    private function withOfferPositions(array $value): array
    {
        foreach ($value as $key => $item) {
            if (! is_array($item)) {
                continue;
            }

            if (array_is_list($item)) {
                foreach ($item as $position => $entry) {
                    if (is_array($entry) && array_key_exists('offer_id', $entry)) {
                        $this->assertIsInt($entry['offer_id']);
                        $item[$position]['offer_id'] = $position + 1;
                    }
                }
            }

            $value[$key] = $this->withOfferPositions($item);
        }

        return $value;
    }
}
