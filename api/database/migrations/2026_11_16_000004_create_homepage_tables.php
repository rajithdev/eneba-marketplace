<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Homepage: which blocks appear, in what order, and the banner content.
 *
 * The frontend hardcodes nothing. `homepage_blocks` is the layout; each block
 * type is filled by its own service class from its own source (banners from
 * the `banners` table, best sellers from sales counts, deals from discounted
 * offers). Reordering, hiding or adding a block is a row change.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('homepage_blocks', function (Blueprint $table) {
            $table->id();
            // Which service fills this block, e.g. "hero_banner", "best_sellers".
            $table->string('type');
            $table->string('title')->nullable();
            $table->integer('position')->default(0);
            // Per-block settings, e.g. {"limit": 8}.
            $table->jsonb('config')->default('{}');
            $table->boolean('is_active')->default(true);
            $table->timestamps();

            $table->index(['is_active', 'position']);
        });

        Schema::create('banners', function (Blueprint $table) {
            $table->id();
            $table->string('title');
            $table->string('subtitle')->nullable();
            $table->string('image_url')->nullable();
            $table->string('link_url');
            $table->string('cta_label')->nullable();
            $table->integer('position')->default(0);
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('banners');
        Schema::dropIfExists('homepage_blocks');
    }
};
