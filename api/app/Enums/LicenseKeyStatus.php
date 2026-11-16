<?php

namespace App\Enums;

enum LicenseKeyStatus: string
{
    /** In stock: any buyer can take it. */
    case Available = 'available';

    /** Held for a pending order until `reserved_until`. */
    case Reserved = 'reserved';

    /** Delivered to a buyer. Final. */
    case Sold = 'sold';
}
