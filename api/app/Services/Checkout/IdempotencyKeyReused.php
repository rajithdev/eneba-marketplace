<?php

namespace App\Services\Checkout;

use RuntimeException;

/** The same Idempotency-Key was sent again with a different cart. */
class IdempotencyKeyReused extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('This Idempotency-Key was already used for a different cart.');
    }
}
