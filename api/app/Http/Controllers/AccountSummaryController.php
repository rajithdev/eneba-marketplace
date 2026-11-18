<?php

namespace App\Http\Controllers;

use App\Enums\LicenseKeyStatus;
use App\Enums\OrderStatus;
use App\Models\LicenseKey;
use App\Models\Order;
use App\Services\Checkout\SettleOrder;
use App\Support\Price;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * The numbers at the top of the account dashboard, counted by the database
 * from the signed-in buyer's own orders. Counts and sums only: never a key.
 */
class AccountSummaryController extends Controller
{
    public function __invoke(Request $request, SettleOrder $settle): JsonResponse
    {
        $user = $request->user();

        // As in the order history: an unpaid order whose payment did go
        // through is completed first, so the numbers agree with the list.
        $user->orders()->where('status', OrderStatus::Pending)->get()
            ->each(fn (Order $order) => $settle->reconcile($order));

        $paid = $user->orders()->where('status', OrderStatus::Paid);

        return response()->json([
            'data' => [
                'orders_count' => $user->orders()->count(),
                'paid_orders_count' => (clone $paid)->count(),
                'pending_orders_count' => $user->orders()->where('status', OrderStatus::Pending)->count(),
                // Keys delivered to this buyer: sold, in one of their paid orders.
                'keys_count' => LicenseKey::query()
                    ->where('status', LicenseKeyStatus::Sold)
                    ->whereHas('orderItem.order', fn ($order) => $order->whereBelongsTo($user)->where('status', OrderStatus::Paid))
                    ->count(),
                'spent' => [
                    'total_cents' => (int) (clone $paid)->sum('total_cents'),
                    'currency' => Price::CURRENCY,
                ],
            ],
        ]);
    }
}
