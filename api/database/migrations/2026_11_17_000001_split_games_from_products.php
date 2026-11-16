<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Separates "the game" from "the thing you can buy".
 *
 * Before: every product row carried its own description, cover image, type
 * and release date, so Elden Ring on Steam GLOBAL, Steam EUROPE and Xbox
 * EUROPE repeated the same text three times.
 *
 * After:
 *   games     what the title is: name, description, cover, type, release date
 *   products  one sellable variant of a game: a platform and a region
 *
 * A product keeps only what is specific to the variant. Its `name` stays: it
 * is the display and search name built from the game, platform and region
 * ("Elden Ring Steam Key GLOBAL"), kept as a column because the trigram
 * search index needs one text column to index.
 */
return new class extends Migration
{
    public function up(): void
    {
        // The new game_id cannot be filled in for rows that already exist.
        // No catalog data existed before this migration (the seeders arrive
        // with it), so this only guards against running it on a wrong database.
        if (DB::table('products')->exists()) {
            throw new RuntimeException('This migration expects an empty products table.');
        }

        Schema::create('games', function (Blueprint $table) {
            $table->id();
            $table->string('slug')->unique();
            $table->string('title');
            $table->text('description')->nullable();
            // One image per game, shared by all of its variants.
            $table->string('cover_image_url')->nullable();
            $table->enum('type', ['game', 'dlc', 'gift_card', 'subscription'])->default('game');
            $table->date('release_date')->nullable();
            $table->timestamps();

            $table->index('type');
            $table->index('release_date');
        });

        Schema::table('products', function (Blueprint $table) {
            // Dropping the column also drops its products_type_check constraint.
            $table->dropColumn(['description', 'cover_image_url', 'type', 'release_date']);

            $table->foreignId('game_id')->constrained()->restrictOnDelete();
            // A game is sold once per platform and region.
            $table->unique(['game_id', 'platform_id', 'region_id']);
        });
    }

    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropUnique(['game_id', 'platform_id', 'region_id']);
            $table->dropConstrainedForeignId('game_id');

            $table->text('description')->nullable();
            $table->string('cover_image_url')->nullable();
            $table->enum('type', ['game', 'dlc', 'gift_card', 'subscription'])->default('game');
            $table->date('release_date')->nullable();
        });

        Schema::dropIfExists('games');
    }
};
