<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * What the checkout needed that the first order tables did not have.
 *
 *   - An order knows until when its keys are held (expires_at), so "which
 *     unpaid orders are overdue" is one indexed question.
 *   - An order remembers which cart it was created for (cart_hash), so a
 *     repeated request can be told apart from a different one that reuses
 *     the same idempotency key.
 *   - "cancelled" exists for orders (the buyer abandoned the checkout) and
 *     for payments (no money moved and none ever will).
 *   - simulated_charges plays the part of the payment provider's own
 *     records: one row per charge reference, decided once.
 *
 * No order exists in any deployed database yet (no code could create one),
 * but the changes are written so they would be safe if one did.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('orders', function (Blueprint $table) {
            $table->timestampTz('expires_at')->nullable();
            // sha256 of the cart the order was created for.
            $table->char('cart_hash', 64)->nullable();
        });

        DB::statement("UPDATE orders SET expires_at = created_at + interval '15 minutes', cart_hash = repeat('0', 64)");
        DB::statement('ALTER TABLE orders ALTER COLUMN expires_at SET NOT NULL');
        DB::statement('ALTER TABLE orders ALTER COLUMN cart_hash SET NOT NULL');

        DB::statement('ALTER TABLE orders DROP CONSTRAINT orders_status_check');
        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'paid', 'failed', 'expired', 'cancelled'))");
        // "Paid" and "has a payment time" are the same fact.
        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_paid_at_check CHECK ((status = 'paid') = (paid_at IS NOT NULL))");
        // Small: only unpaid orders are in it. Used to find overdue ones.
        DB::statement("CREATE INDEX orders_pending_expires_at_index ON orders (expires_at) WHERE status = 'pending'");

        Schema::table('order_items', function (Blueprint $table) {
            // The struck-through "was" price at purchase time, for the receipt.
            $table->integer('original_unit_price_cents')->nullable();
        });

        Schema::table('payments', function (Blueprint $table) {
            // What the buyer paid with, as the provider describes it.
            $table->string('method')->nullable();
        });

        DB::statement('ALTER TABLE payments DROP CONSTRAINT payments_status_check');
        DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'succeeded', 'failed', 'cancelled'))");

        Schema::create('simulated_charges', function (Blueprint $table) {
            $table->id();
            // The reference we send with a charge (the order's public id).
            // Unique: a reference is decided once, as charged, declined or
            // cancelled, and every later request gets that same answer.
            $table->string('reference')->unique();
            $table->enum('status', ['succeeded', 'declined', 'cancelled']);
            $table->integer('amount_cents')->nullable();
            $table->char('currency', 3)->nullable();
            $table->string('method')->nullable();
            $table->string('failure_code')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('simulated_charges');

        // The older schema has no "cancelled": fold it into the nearest
        // state it does have, so the old constraints can be put back.
        DB::statement("UPDATE payments SET status = 'failed' WHERE status = 'cancelled'");
        DB::statement("UPDATE orders SET status = 'expired' WHERE status = 'cancelled'");

        DB::statement('ALTER TABLE payments DROP CONSTRAINT payments_status_check');
        DB::statement("ALTER TABLE payments ADD CONSTRAINT payments_status_check CHECK (status IN ('pending', 'succeeded', 'failed'))");
        Schema::table('payments', fn (Blueprint $table) => $table->dropColumn('method'));

        Schema::table('order_items', fn (Blueprint $table) => $table->dropColumn('original_unit_price_cents'));

        DB::statement('DROP INDEX orders_pending_expires_at_index');
        DB::statement('ALTER TABLE orders DROP CONSTRAINT orders_paid_at_check');
        DB::statement('ALTER TABLE orders DROP CONSTRAINT orders_status_check');
        DB::statement("ALTER TABLE orders ADD CONSTRAINT orders_status_check CHECK (status IN ('pending', 'paid', 'failed', 'expired'))");
        Schema::table('orders', fn (Blueprint $table) => $table->dropColumn(['expires_at', 'cart_hash']));
    }
};
