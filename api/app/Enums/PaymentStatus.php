<?php

namespace App\Enums;

/**
 * Where the money is. Recorded apart from the order's status, which says
 * who owns the keys.
 */
enum PaymentStatus: string
{
    /** No result recorded yet. */
    case Pending = 'pending';

    /** The buyer was charged. */
    case Succeeded = 'succeeded';

    /** The provider declined the charge; no money moved. */
    case Failed = 'failed';

    /** Never charged, and the provider will refuse to charge it from now on. */
    case Cancelled = 'cancelled';
}
