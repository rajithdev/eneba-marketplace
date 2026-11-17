<?php

namespace App\Services\Checkout;

use RuntimeException;

/**
 * The cart cannot be bought as the buyer saw it: a price differs, an offer
 * is gone, or there are not enough keys. Carries the up-to-date quote so the
 * buyer can be shown what changed. Nothing was reserved.
 */
class CartChanged extends RuntimeException
{
    /** @param array<string, mixed> $quote */
    public function __construct(public readonly array $quote)
    {
        parent::__construct('The cart has changed since it was last shown.');
    }
}
