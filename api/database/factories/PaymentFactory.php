<?php

namespace Database\Factories;

use App\Enums\PaymentStatus;
use App\Models\Order;
use App\Models\Payment;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Payment>
 */
class PaymentFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'order_id' => Order::factory(),
            'provider' => 'simulated',
            'provider_reference' => null,
            'status' => PaymentStatus::Pending,
            'amount_cents' => fn (array $attributes) => Order::findOrFail($attributes['order_id'])->total_cents,
            'currency' => 'EUR',
            'failure_code' => null,
        ];
    }
}
