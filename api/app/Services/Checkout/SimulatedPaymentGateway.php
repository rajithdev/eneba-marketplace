<?php

namespace App\Services\Checkout;

use App\Enums\ChargeStatus;
use Illuminate\Support\Facades\DB;
use InvalidArgumentException;

/**
 * A stand-in for a payment provider. No money moves and no card details are
 * ever asked for: the buyer picks one of a few test cards, each with a
 * fixed outcome.
 *
 * Its decisions live in the simulated_charges table, which plays the part
 * of the provider's own records. The unique index on `reference` is what
 * makes a reference "decided once": the insert below does nothing when a
 * row already exists, and the stored row is returned either way. When two
 * requests decide the same reference at the same moment, the database lets
 * exactly one insert win.
 *
 * Never call this inside a database transaction: a provider's decision does
 * not roll back with ours, and neither should this one.
 */
class SimulatedPaymentGateway implements PaymentGateway
{
    /** A null failure code means the charge is approved. */
    private const METHODS = [
        'test_card_approved' => [
            'label' => 'Test card ending 4242',
            'description' => 'The payment is approved.',
            'failure_code' => null,
        ],
        'test_card_declined' => [
            'label' => 'Test card ending 0002',
            'description' => 'The bank declines the payment.',
            'failure_code' => 'card_declined',
        ],
        'test_card_insufficient_funds' => [
            'label' => 'Test card ending 9995',
            'description' => 'Declined for insufficient funds.',
            'failure_code' => 'insufficient_funds',
        ],
    ];

    public function methods(): array
    {
        $methods = [];

        foreach (self::METHODS as $value => $method) {
            $methods[] = ['value' => $value, 'label' => $method['label'], 'description' => $method['description']];
        }

        return $methods;
    }

    public function charge(string $reference, int $amountCents, string $currency, string $method): ChargeResult
    {
        $chosen = self::METHODS[$method] ?? throw new InvalidArgumentException("Unknown payment method [{$method}].");

        return $this->decide($reference, [
            'status' => $chosen['failure_code'] === null ? ChargeStatus::Succeeded->value : ChargeStatus::Declined->value,
            'amount_cents' => $amountCents,
            'currency' => $currency,
            'method' => $chosen['label'],
            'failure_code' => $chosen['failure_code'],
        ]);
    }

    public function cancel(string $reference): ChargeResult
    {
        return $this->decide($reference, ['status' => ChargeStatus::Cancelled->value]);
    }

    public function find(string $reference): ?ChargeResult
    {
        $row = DB::table('simulated_charges')->where('reference', $reference)->first();

        return $row === null ? null : new ChargeResult(
            status: ChargeStatus::from($row->status),
            providerReference: 'sim_'.$row->id,
            method: $row->method,
            failureCode: $row->failure_code,
        );
    }

    /**
     * Record the decision unless one already stands, then return whichever
     * stands. (INSERT ... ON CONFLICT DO NOTHING.)
     *
     * @param  array<string, mixed>  $decision
     */
    private function decide(string $reference, array $decision): ChargeResult
    {
        DB::table('simulated_charges')->insertOrIgnore([
            'reference' => $reference,
            ...$decision,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return $this->find($reference);
    }
}
