<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Marketplace: who sells a product and for how much.
 *
 * An offer is one seller's price for one product. A product page lists all of
 * its offers so the buyer can compare; the cart holds offers, not products,
 * because the buyer picked a specific seller.
 *
 * Money is stored as whole cents in an integer column, never as a float.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('sellers', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            // Share of positive feedback, 0.00 to 100.00.
            $table->decimal('rating_percent', 5, 2)->default(100);
            $table->integer('sales_count')->default(0);
            $table->timestamps();
        });

        DB::statement('ALTER TABLE sellers ADD CONSTRAINT sellers_rating_percent_check CHECK (rating_percent BETWEEN 0 AND 100)');
        DB::statement('ALTER TABLE sellers ADD CONSTRAINT sellers_sales_count_check CHECK (sales_count >= 0)');

        Schema::create('offers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('product_id')->constrained()->cascadeOnDelete();
            $table->foreignId('seller_id')->constrained()->cascadeOnDelete();
            $table->integer('price_cents');
            // The "was" price shown struck through. NULL means no discount.
            $table->integer('original_price_cents')->nullable();
            $table->char('currency', 3)->default('EUR');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            // A seller has at most one offer per product.
            $table->unique(['product_id', 'seller_id']);
            // Finding the cheapest offer of a product is the most common query.
            $table->index(['product_id', 'price_cents']);
        });

        DB::statement('ALTER TABLE offers ADD CONSTRAINT offers_price_cents_check CHECK (price_cents > 0)');
        DB::statement('ALTER TABLE offers ADD CONSTRAINT offers_original_price_check CHECK (original_price_cents IS NULL OR original_price_cents >= price_cents)');
    }

    public function down(): void
    {
        Schema::dropIfExists('offers');
        Schema::dropIfExists('sellers');
    }
};
