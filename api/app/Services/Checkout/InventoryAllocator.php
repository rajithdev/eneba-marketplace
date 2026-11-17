<?php

namespace App\Services\Checkout;

use App\Enums\LicenseKeyStatus;
use App\Models\LicenseKey;
use App\Models\Order;
use App\Models\OrderItem;
use DateTimeInterface;
use Illuminate\Support\Facades\DB;
use LogicException;

/**
 * Moves license keys between their three states. It knows about keys and
 * order lines and nothing about payments.
 *
 *   available --reserve--> reserved --confirm--> sold
 *                             |
 *                             +------release---> available
 *
 * Every method must be called inside a database transaction, so that a key
 * never changes state without the order that explains why.
 */
class InventoryAllocator
{
    /**
     * Hold `quantity` keys of the line's offer for it.
     *
     * FOR UPDATE locks the chosen keys until the transaction ends, so no
     * other buyer can take them. SKIP LOCKED makes a second buyer pass over
     * keys someone else is taking at this very moment instead of waiting
     * for them: two buyers can never be given the same key, and the one who
     * finds too few is told so immediately.
     *
     * @throws OutOfStock when fewer keys are free than the line needs
     */
    public function reserve(OrderItem $item, DateTimeInterface $until): void
    {
        $free = DB::select(
            "SELECT id FROM license_keys
              WHERE offer_id = ? AND status = 'available'
              ORDER BY id
              LIMIT ?
              FOR UPDATE SKIP LOCKED",
            [$item->offer_id, $item->quantity],
        );

        if (count($free) < $item->quantity) {
            throw new OutOfStock("Offer {$item->offer_id} has fewer than {$item->quantity} keys available.");
        }

        LicenseKey::whereIn('id', array_column($free, 'id'))->update([
            'status' => LicenseKeyStatus::Reserved,
            'order_item_id' => $item->id,
            'reserved_until' => $until,
        ]);
    }

    /**
     * The order was paid for: its held keys now belong to the buyer.
     *
     * An order's keys are only ever released by release() below, which runs
     * when the order ends unpaid. A paid order with a key missing therefore
     * means a bug, and it is better to stop loudly (the transaction rolls
     * back and the order stays pending) than to deliver fewer keys than
     * were paid for.
     */
    public function confirm(Order $order): void
    {
        $sold = $this->reservedKeysOf($order)->update([
            'status' => LicenseKeyStatus::Sold,
            'sold_at' => now(),
        ]);

        $expected = (int) $order->items()->sum('quantity');

        if ($sold !== $expected) {
            throw new LogicException("Order {$order->public_id} holds {$sold} keys but was paid for {$expected}.");
        }
    }

    /** The order ended unpaid: its held keys go back on sale. */
    public function release(Order $order): void
    {
        $this->reservedKeysOf($order)->update([
            'status' => LicenseKeyStatus::Available,
            'order_item_id' => null,
            'reserved_until' => null,
        ]);
    }

    private function reservedKeysOf(Order $order)
    {
        return LicenseKey::query()
            ->whereIn('order_item_id', $order->items()->select('id'))
            ->where('status', LicenseKeyStatus::Reserved);
    }
}
