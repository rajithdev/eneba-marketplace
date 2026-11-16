<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Catalog: what can be bought.
 *
 * A product is one sellable variant, the way Eneba lists them: a title on a
 * specific platform for a specific region ("Elden Ring Steam Key GLOBAL").
 * Prices do not live here; they belong to seller offers (next migration).
 */
return new class extends Migration
{
    public function up(): void
    {
        // Trigram matching powers typo-tolerant and partial-name search.
        DB::statement('CREATE EXTENSION IF NOT EXISTS pg_trgm');

        Schema::create('platforms', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->timestamps();
        });

        Schema::create('regions', function (Blueprint $table) {
            $table->id();
            $table->string('name');
            $table->string('slug')->unique();
            $table->timestamps();
        });

        Schema::create('products', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            $table->string('name');
            $table->text('description')->nullable();
            $table->string('cover_image_url')->nullable();
            $table->foreignId('platform_id')->constrained()->restrictOnDelete();
            $table->foreignId('region_id')->constrained()->restrictOnDelete();
            $table->enum('type', ['game', 'dlc', 'gift_card', 'subscription'])->default('game');
            $table->date('release_date')->nullable();
            // Units sold. Seeded with a baseline and incremented by real
            // purchases; the "best sellers" homepage block sorts by it.
            $table->integer('sales_count')->default(0);
            $table->timestamps();

            $table->index('platform_id');
            $table->index('region_id');
            $table->index('sales_count');
        });

        DB::statement('ALTER TABLE products ADD CONSTRAINT products_sales_count_check CHECK (sales_count >= 0)');

        // GIN trigram index: lets "eldn rng" or "elden r" find "Elden Ring"
        // without scanning every row.
        DB::statement('CREATE INDEX products_name_trgm_index ON products USING gin (name gin_trgm_ops)');
    }

    public function down(): void
    {
        Schema::dropIfExists('products');
        Schema::dropIfExists('regions');
        Schema::dropIfExists('platforms');
    }
};
