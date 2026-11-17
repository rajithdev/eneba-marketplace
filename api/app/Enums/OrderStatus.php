<?php

namespace App\Enums;

/**
 * Whether the buyer owns the keys. An order starts pending and ends in
 * exactly one of the other states; none of those is ever left again.
 *
 *   pending -> paid        the payment succeeded
 *   pending -> failed      the payment was declined
 *   pending -> expired     not paid before the deadline
 *   pending -> cancelled   abandoned by the buyer before the deadline
 *
 * The only code that moves an order out of pending is SettleOrder.
 */
enum OrderStatus: string
{
    /** Keys are held for the buyer; payment has not finished yet. */
    case Pending = 'pending';

    /** Payment succeeded and the keys belong to the buyer. */
    case Paid = 'paid';

    /** Payment was declined; the keys went back on sale. */
    case Failed = 'failed';

    /** Not paid in time; the keys went back on sale. */
    case Expired = 'expired';

    /** The buyer cancelled or started another checkout; the keys went back on sale. */
    case Cancelled = 'cancelled';
}
