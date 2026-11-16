<?php

namespace Database\Factories;

use App\Enums\OrderStatus;
use App\Models\Order;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Order>
 */
class OrderFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'public_id' => (string) Str::uuid(),
            'user_id' => User::factory(),
            'status' => OrderStatus::Pending,
            'total_cents' => fake()->numberBetween(500, 20_000),
            'currency' => 'EUR',
            'idempotency_key' => (string) Str::uuid(),
        ];
    }

    public function paid(): static
    {
        return $this->state(fn () => [
            'status' => OrderStatus::Paid,
            'paid_at' => now(),
        ]);
    }
}
