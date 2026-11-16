<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Orders, payments and the digital keys themselves.
 *
 * Checkout runs in three steps (see docs/ARCHITECTURE.md, "Checkout"):
 *   1. reserve keys and create a pending order      (one database transaction)
 *   2. charge the payment gateway                    (no transaction held open)
 *   3. mark keys sold and the order paid, or release (one database transaction)
 *
 * The constraints below make the dangerous mistakes impossible at the
 * database level, whatever the application code does:
 *   - the same checkout submitted twice cannot create two orders,
 *   - a key cannot be sold without belonging to an order line,
 *   - an order cannot be charged twice.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('orders', function (Blueprint $table) {
            $table->id();
            // Random identifier used in URLs, so order numbers cannot be guessed.
            $table->uuid('public_id')->unique();
            $table->foreignId('user_id')->constrained()->restrictOnDelete();
            $table->enum('status', ['pending', 'paid', 'failed', 'expired'])->default('pending');
            $table->integer('total_cents');
            $table->char('currency', 3)->default('EUR');
            // Sent by the browser once per checkout attempt. Retrying or
            // double-clicking re-sends the same value.
            $table->string('idempotency_key', 100);
            $table->string('failure_reason')->nullable();
            $table->timestampTz('paid_at')->nullable();
            $table->timestamps();

            // Duplicate-request protection: one order per user per attempt.
            $table->unique(['user_id', 'idempotency_key']);
            $table->index(['user_id', 'created_at']);
        });

        DB::statement('ALTER TABLE orders ADD CONSTRAINT orders_total_cents_check CHECK (total_cents >= 0)');

        Schema::create('order_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->foreignId('offer_id')->constrained()->restrictOnDelete();
            $table->foreignId('product_id')->constrained()->restrictOnDelete();
            // Copied at purchase time so order history stays correct when a
            // product is renamed or an offer's price changes later.
            $table->string('product_name');
            $table->string('seller_name');
            $table->integer('unit_price_cents');
            $table->smallInteger('quantity');
            $table->timestamps();

            $table->unique(['order_id', 'offer_id']);
        });

        DB::statement('ALTER TABLE order_items ADD CONSTRAINT order_items_unit_price_cents_check CHECK (unit_price_cents > 0)');
        DB::statement('ALTER TABLE order_items ADD CONSTRAINT order_items_quantity_check CHECK (quantity >= 1)');

        Schema::create('payments', function (Blueprint $table) {
            $table->id();
            // One payment attempt per order. A declined checkout is retried as
            // a new order, so an order can never be charged twice.
            $table->foreignId('order_id')->unique()->constrained()->cascadeOnDelete();
            $table->string('provider')->default('simulated');
            // The gateway's own id for the charge.
            $table->string('provider_reference')->nullable()->unique();
            $table->enum('status', ['pending', 'succeeded', 'failed'])->default('pending');
            $table->integer('amount_cents');
            $table->char('currency', 3)->default('EUR');
            $table->string('failure_code')->nullable();
            $table->timestamps();
        });

        DB::statement('ALTER TABLE payments ADD CONSTRAINT payments_amount_cents_check CHECK (amount_cents >= 0)');

        Schema::create('license_keys', function (Blueprint $table) {
            $table->id();
            $table->foreignId('offer_id')->constrained()->restrictOnDelete();
            $table->string('code')->unique();
            $table->enum('status', ['available', 'reserved', 'sold'])->default('available');
            $table->foreignId('order_item_id')->nullable()->constrained()->restrictOnDelete();
            // A reservation that is never paid for is released after this time.
            $table->timestampTz('reserved_until')->nullable();
            $table->timestampTz('sold_at')->nullable();
            $table->timestamps();

            $table->index('order_item_id');
        });

        // Stock is not a number stored on the offer: it is the count of
        // available keys, so it can never disagree with what can be delivered.
        // A key is always in exactly one of three consistent states.
        DB::statement(<<<'SQL'
            ALTER TABLE license_keys ADD CONSTRAINT license_keys_state_check CHECK (
                (status = 'available' AND order_item_id IS NULL     AND reserved_until IS NULL     AND sold_at IS NULL)
             OR (status = 'reserved'  AND order_item_id IS NOT NULL AND reserved_until IS NOT NULL AND sold_at IS NULL)
             OR (status = 'sold'      AND order_item_id IS NOT NULL AND sold_at IS NOT NULL)
            )
        SQL);

        // Partial indexes: small, and exactly what the two hot queries need
        // ("give me N available keys of this offer", "which reservations expired").
        DB::statement("CREATE INDEX license_keys_available_index ON license_keys (offer_id, id) WHERE status = 'available'");
        DB::statement("CREATE INDEX license_keys_reserved_until_index ON license_keys (reserved_until) WHERE status = 'reserved'");
    }

    public function down(): void
    {
        Schema::dropIfExists('license_keys');
        Schema::dropIfExists('payments');
        Schema::dropIfExists('order_items');
        Schema::dropIfExists('orders');
    }
};
