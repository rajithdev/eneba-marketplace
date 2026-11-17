<?php

namespace Tests\Concerns;

use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\Order;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Testing\TestResponse;

/** Shared set-up for the cart and checkout tests. */
trait BuildsCheckouts
{
    /**
     * A seller's offer with this many keys in stock.
     *
     * @param  array<string, mixed>  $attributes
     */
    protected function offer(int $priceCents = 1000, int $keys = 3, array $attributes = []): Offer
    {
        $offer = Offer::factory()->create(['price_cents' => $priceCents, ...$attributes]);
        LicenseKey::factory()->count($keys)->for($offer)->create();

        return $offer;
    }

    /**
     * A cart item as the browser sends it. The price defaults to the
     * offer's current one: "what the buyer was last shown".
     *
     * @return array{offer_id: int, quantity: int, unit_price_cents: int}
     */
    protected function item(Offer $offer, int $quantity = 1, ?int $shownPriceCents = null): array
    {
        return ['offer_id' => $offer->id, 'quantity' => $quantity, 'unit_price_cents' => $shownPriceCents ?? $offer->price_cents];
    }

    /** @param list<array<string, mixed>> $items */
    protected function placeOrder(User $user, array $items, ?string $idempotencyKey = null): TestResponse
    {
        return $this->actingAs($user)->postJson('/api/orders', ['items' => $items], [
            'Idempotency-Key' => $idempotencyKey ?? (string) Str::uuid(),
        ]);
    }

    /** Place an order that is expected to succeed and return it. */
    protected function pendingOrder(User $user, Offer $offer, int $quantity = 1): Order
    {
        $id = $this->placeOrder($user, [$this->item($offer, $quantity)])->assertCreated()->json('data.id');

        return Order::where('public_id', $id)->firstOrFail();
    }

    protected function pay(User $user, Order|string $order, string $method = 'test_card_approved'): TestResponse
    {
        $id = $order instanceof Order ? $order->public_id : $order;

        return $this->actingAs($user)->postJson("/api/orders/{$id}/pay", ['payment_method' => $method]);
    }

    /**
     * How many of the offer's keys are in each state.
     *
     * @return array{available: int, reserved: int, sold: int}
     */
    protected function keys(Offer $offer): array
    {
        $counts = DB::table('license_keys')->where('offer_id', $offer->id)
            ->selectRaw('status, count(*) as total')->groupBy('status')->pluck('total', 'status');

        return [
            'available' => (int) ($counts['available'] ?? 0),
            'reserved' => (int) ($counts['reserved'] ?? 0),
            'sold' => (int) ($counts['sold'] ?? 0),
        ];
    }

    /** What the payment provider decided for the order, or null. */
    protected function charge(Order $order): ?string
    {
        return DB::table('simulated_charges')->where('reference', $order->public_id)->value('status');
    }
}
