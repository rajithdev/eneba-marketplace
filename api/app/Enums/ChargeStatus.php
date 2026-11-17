<?php

namespace App\Enums;

/** What the payment provider decided for one charge reference. Final. */
enum ChargeStatus: string
{
    case Succeeded = 'succeeded';
    case Declined = 'declined';
    case Cancelled = 'cancelled';
}
