<?php

namespace App\Services\Checkout;

use App\Enums\ChargeStatus;

/** The payment provider's decision for one charge reference. */
final readonly class ChargeResult
{
    public function __construct(
        public ChargeStatus $status,
        /** The provider's own id for the decision. */
        public string $providerReference,
        /** What the buyer paid with, as the provider describes it. */
        public ?string $method = null,
        /** Why it was declined, e.g. "insufficient_funds". */
        public ?string $failureCode = null,
    ) {}
}
