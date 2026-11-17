<?php

namespace App\Services\Checkout;

/**
 * The payment provider, as the checkout sees it. It knows about charging an
 * amount against a reference and nothing about orders or keys.
 *
 * The one rule everything else relies on: a reference is decided ONCE. The
 * first charge() or cancel() for a reference fixes its outcome, and every
 * later call with that reference, of either kind, returns that same outcome
 * without doing anything. So:
 *
 *   - asking twice never charges twice,
 *   - after a cancel no charge can succeed,
 *   - after a successful charge a cancel changes nothing and says so.
 *
 * Real providers work the same way (an idempotency key on the charge, and a
 * payment that can be cancelled before it is confirmed).
 */
interface PaymentGateway
{
    /**
     * The ways to pay that the buyer can choose from.
     *
     * @return list<array{value: string, label: string, description: string}>
     */
    public function methods(): array;

    /** Charge the amount, unless the reference is already decided. */
    public function charge(string $reference, int $amountCents, string $currency, string $method): ChargeResult;

    /** Make sure the reference can never be charged, unless it already was. */
    public function cancel(string $reference): ChargeResult;

    /** What was decided for the reference, or null if nothing yet. */
    public function find(string $reference): ?ChargeResult;
}
