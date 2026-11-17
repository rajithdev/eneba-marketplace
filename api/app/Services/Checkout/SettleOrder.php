<?php

namespace App\Services\Checkout;

use App\Enums\ChargeStatus;
use App\Enums\OrderStatus;
use App\Enums\PaymentStatus;
use App\Models\Offer;
use App\Models\Order;
use App\Models\Product;
use App\Models\Seller;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Steps 2 and 3 of a purchase, and the only code that moves an order out of
 * "pending".
 *
 * The rule: an order's fate is whatever the payment provider decided for its
 * reference (the order's public id), and the provider decides a reference
 * once (see PaymentGateway).
 *
 *   charged    -> paid       the held keys are sold to the buyer
 *   declined   -> failed     the held keys go back on sale
 *   cancelled  -> expired or cancelled, and the keys go back on sale
 *
 * Every way out of pending has two parts: first get the provider's decision
 * (no database transaction open, because that may be a slow network call),
 * then record it in one short transaction (apply()).
 *
 * Because keys are only released after the provider has confirmed that no
 * money moved, and only sold after it confirmed that money did, a crash at
 * any point leaves an order that the next call to pay(), cancel() or
 * refresh() finishes correctly: nothing is lost and nothing happens twice.
 */
class SettleOrder
{
    public function __construct(
        private PaymentGateway $gateway,
        private InventoryAllocator $inventory,
    ) {}

    /**
     * The buyer pays. Past the deadline nothing is charged: the order is
     * cancelled at the provider instead.
     */
    public function pay(Order $order, string $method): Order
    {
        if ($order->status !== OrderStatus::Pending) {
            return $order;
        }

        $decision = $order->expires_at->isPast()
            ? $this->gateway->cancel($order->public_id)
            : $this->gateway->charge($order->public_id, $order->total_cents, $order->currency, $method);

        return $this->apply($order, $decision);
    }

    /**
     * Give the order up. If the buyer was in fact charged already, the
     * provider says so and the order is completed as paid instead.
     */
    public function cancel(Order $order): Order
    {
        if ($order->status !== OrderStatus::Pending) {
            return $order;
        }

        return $this->apply($order, $this->gateway->cancel($order->public_id));
    }

    /**
     * Bring a pending order up to date without deciding anything new:
     * record a payment result we never got to record (a crash after
     * charging), and expire the order if its deadline has passed.
     */
    public function refresh(Order $order): Order
    {
        if ($order->status !== OrderStatus::Pending) {
            return $order;
        }

        if ($decision = $this->gateway->find($order->public_id)) {
            return $this->apply($order, $decision);
        }

        return $order->expires_at->isPast() ? $this->cancel($order) : $order;
    }

    /**
     * refresh() for when the buyer comes back to look at their orders. The
     * buyer must be able to see an order even if bringing it up to date
     * fails just now (the payment provider does not answer, say): the
     * failure is logged, the order is shown as it stands, and the next
     * visit or the expiry clean-up tries again. Nothing is lost by waiting,
     * because the order's keys stay held until the provider has answered.
     */
    public function reconcile(Order $order): Order
    {
        try {
            return $this->refresh($order);
        } catch (Throwable $exception) {
            report($exception);

            return $order;
        }
    }

    /**
     * Settle unpaid orders whose deadline has passed, oldest first, so their
     * keys go back on sale. There is no background worker on the free
     * hosting tier, so this runs at the start of requests that read stock
     * (see the ReleaseExpiredReservations middleware) and from the
     * `orders:expire` command.
     *
     * One order failing must not stop the others, or break the request that
     * happened to trigger the clean-up, so its error is logged and skipped.
     *
     * @return int how many orders were settled
     */
    public function expireOverdue(int $limit = 20): int
    {
        $overdue = Order::query()
            ->where('status', OrderStatus::Pending)
            ->where('expires_at', '<=', now())
            ->orderBy('expires_at')
            ->limit($limit)
            ->get();

        $settled = 0;

        foreach ($overdue as $order) {
            try {
                $settled += $this->cancel($order)->status === OrderStatus::Pending ? 0 : 1;
            } catch (Throwable $exception) {
                report($exception);
            }
        }

        return $settled;
    }

    /**
     * Record the provider's decision. One transaction: the order, its
     * payment and its keys change together or not at all.
     *
     * The order row is locked first and its status read again. If two
     * requests settle the same order at once (a double click on "Pay"), the
     * second waits for the first, finds the order no longer pending and
     * changes nothing.
     *
     * Locks are always taken in the same order (this order's row, its keys,
     * its payment, then the counters in countSales), so two payments cannot
     * deadlock. Should the database still abort the transaction as a
     * deadlock for a reason not foreseen here, it has undone every change,
     * and because the order is read again under the lock it is safe to run
     * again: that is tried up to three times before the error is let out.
     */
    private function apply(Order $order, ChargeResult $decision): Order
    {
        return DB::transaction(function () use ($order, $decision) {
            $order = Order::query()->whereKey($order->id)->lockForUpdate()->firstOrFail();

            if ($order->status !== OrderStatus::Pending) {
                return $order;
            }

            $payment = ['provider_reference' => $decision->providerReference, 'method' => $decision->method];

            switch ($decision->status) {
                case ChargeStatus::Succeeded:
                    $this->inventory->confirm($order);
                    $order->payment()->update([...$payment, 'status' => PaymentStatus::Succeeded]);
                    $order->update(['status' => OrderStatus::Paid, 'paid_at' => now()]);
                    $this->countSales($order);
                    break;

                case ChargeStatus::Declined:
                    $this->inventory->release($order);
                    $order->payment()->update([...$payment, 'status' => PaymentStatus::Failed, 'failure_code' => $decision->failureCode]);
                    $order->update(['status' => OrderStatus::Failed, 'failure_reason' => $decision->failureCode]);
                    break;

                case ChargeStatus::Cancelled:
                    $this->inventory->release($order);
                    $order->payment()->update([...$payment, 'status' => PaymentStatus::Cancelled]);
                    // "Expired" when time ran out, "cancelled" when the
                    // buyer gave the order up before that.
                    $order->update(['status' => $order->expires_at->isPast() ? OrderStatus::Expired : OrderStatus::Cancelled]);
                    break;
            }

            return $order;
        }, attempts: 3);
    }

    /**
     * Popularity counters shown in the store, raised by what was just bought.
     *
     * Each increment locks one product or seller row until the payment's
     * transaction ends. Two payments that took those locks in different
     * orders could each end up waiting for a row the other holds; the
     * database then aborts one of them, after its buyer was charged. So
     * every payment takes them in the same order: products by id, then
     * sellers by id. A payment can then only ever wait for one that is
     * ahead of it, never for one that is also waiting for it.
     */
    private function countSales(Order $order): void
    {
        $sellerOf = Offer::whereKey($order->items->pluck('offer_id'))->pluck('seller_id', 'id');

        $soldByProduct = $order->items->groupBy('product_id')->map->sum('quantity')->sortKeys();
        $soldBySeller = $order->items->groupBy(fn ($item) => $sellerOf[$item->offer_id])->map->sum('quantity')->sortKeys();

        foreach ($soldByProduct as $productId => $quantity) {
            Product::whereKey($productId)->increment('sales_count', $quantity);
        }

        foreach ($soldBySeller as $sellerId => $quantity) {
            Seller::whereKey($sellerId)->increment('sales_count', $quantity);
        }
    }
}
