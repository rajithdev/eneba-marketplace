<?php

use App\Enums\OrderStatus;
use App\Models\Order;
use App\Services\Checkout\SettleOrder;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * A buyer has one checkout in progress at a time. Until now only the
 * application checked that ("cancel my earlier unpaid orders, then create
 * the new one"), and two requests arriving together could both pass the
 * check. The database now refuses a second unpaid order for the same buyer,
 * whatever the timing.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The rule cannot be added while a buyer already has several unpaid
        // orders. Give up all but the newest, exactly as starting a new
        // checkout does: cancelled at the payment provider first, then the
        // keys go back on sale (or, had the buyer in fact been charged, the
        // order is completed as paid).
        Order::query()->where('status', OrderStatus::Pending)->orderByDesc('id')->get()
            ->groupBy('user_id')
            ->each(fn ($orders) => $orders->skip(1)->each(fn (Order $order) => app(SettleOrder::class)->cancel($order)));

        DB::statement("CREATE UNIQUE INDEX orders_one_pending_per_user ON orders (user_id) WHERE status = 'pending'");
    }

    public function down(): void
    {
        DB::statement('DROP INDEX orders_one_pending_per_user');
    }
};
