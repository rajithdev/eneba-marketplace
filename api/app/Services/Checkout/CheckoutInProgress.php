<?php

namespace App\Services\Checkout;

use RuntimeException;

/**
 * The buyer started several checkouts at the same moment and this one lost
 * to another twice in a row. Nothing was held; the buyer can try again.
 */
class CheckoutInProgress extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Another checkout for your account started at the same moment. Please try again.');
    }
}
