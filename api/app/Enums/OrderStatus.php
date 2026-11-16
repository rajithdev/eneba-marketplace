<?php

namespace App\Enums;

enum OrderStatus: string
{
    /** Keys are reserved; payment has not finished yet. */
    case Pending = 'pending';

    /** Payment succeeded and the keys belong to the buyer. */
    case Paid = 'paid';

    /** Payment was declined; the reserved keys were released. */
    case Failed = 'failed';

    /** Never paid for; the reservation timed out and the keys were released. */
    case Expired = 'expired';
}
