<?php

namespace Database\Factories;

use App\Enums\LicenseKeyStatus;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\OrderItem;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<LicenseKey>
 */
class LicenseKeyFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'offer_id' => Offer::factory(),
            'code' => strtoupper(fake()->unique()->bothify('?#?#?-#?#?#-?#?#?')),
            'status' => LicenseKeyStatus::Available,
            'order_item_id' => null,
            'reserved_until' => null,
            'sold_at' => null,
        ];
    }

    /** Held for a pending order. */
    public function reservedFor(OrderItem $item, int $minutes = 15): static
    {
        return $this->state(fn () => [
            'offer_id' => $item->offer_id,
            'status' => LicenseKeyStatus::Reserved,
            'order_item_id' => $item->id,
            'reserved_until' => now()->addMinutes($minutes),
        ]);
    }

    /** Delivered to the buyer of the given order line. */
    public function soldTo(OrderItem $item): static
    {
        return $this->state(fn () => [
            'offer_id' => $item->offer_id,
            'status' => LicenseKeyStatus::Sold,
            'order_item_id' => $item->id,
            'sold_at' => now(),
        ]);
    }
}
