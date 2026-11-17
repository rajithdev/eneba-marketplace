<?php

namespace App\Services\Checkout;

use RuntimeException;

/**
 * Another checkout of the same buyer, for a different cart, was saved in the
 * moment between this request looking and this request saving. That order
 * stands. This request held nothing; the buyer can try again.
 */
class CheckoutInProgress extends RuntimeException
{
    public function __construct()
    {
        parent::__construct('Another checkout for your account started at the same moment. Please try again.');
    }
}
