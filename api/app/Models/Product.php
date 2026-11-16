<?php

namespace App\Models;

use App\Enums\GameType;
use Database\Factories\ProductFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

/**
 * One sellable variant of a game: that game on one platform for one region.
 * What the game is (description, cover, type, release date) lives on Game.
 * A product has no price of its own; sellers price it through offers.
 */
#[Fillable(['slug', 'name', 'game_id', 'platform_id', 'region_id', 'sales_count'])]
class Product extends Model
{
    /** @use HasFactory<ProductFactory> */
    use HasFactory;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'sales_count' => 'integer',
            // Present only when loaded through withBestOffer().
            'best_price_cents' => 'integer',
            'best_original_price_cents' => 'integer',
            'in_stock_offers_count' => 'integer',
        ];
    }

    /**
     * The name shown to buyers, built from the parts so it is never typed by
     * hand: "Elden Ring Steam Key GLOBAL". Gift cards and subscriptions
     * already name their platform in the title, so it is not repeated.
     */
    public static function displayName(Game $game, Platform $platform, Region $region): string
    {
        $region = Str::upper($region->name);

        return in_array($game->type, [GameType::GiftCard, GameType::Subscription], true)
            ? "{$game->title} {$region}"
            : "{$game->title} {$platform->name} Key {$region}";
    }

    /** @return BelongsTo<Game, $this> */
    public function game(): BelongsTo
    {
        return $this->belongsTo(Game::class);
    }

    /** @return BelongsTo<Platform, $this> */
    public function platform(): BelongsTo
    {
        return $this->belongsTo(Platform::class);
    }

    /** @return BelongsTo<Region, $this> */
    public function region(): BelongsTo
    {
        return $this->belongsTo(Region::class);
    }

    /** @return HasMany<Offer, $this> */
    public function offers(): HasMany
    {
        return $this->hasMany(Offer::class);
    }

    /**
     * Adds each product's best offer: the cheapest active offer that still
     * has a key to sell. A product whose offers are all sold out gets NULLs,
     * which is how "sold out" is recognised.
     *
     * Columns added: best_offer_id, best_price_cents,
     * best_original_price_cents, in_stock_offers_count.
     *
     * LATERAL lets the inner query refer to the product of the outer row, so
     * PostgreSQL finds the one cheapest offer per product using the
     * (product_id, price_cents) index instead of sorting every offer.
     *
     * @param  Builder<Product>  $query
     */
    public function scopeWithBestOffer(Builder $query): void
    {
        $inStock = Offer::query()->sellable()->whereColumn('offers.product_id', 'products.id');

        $query
            ->select('products.*')
            ->leftJoinLateral(
                (clone $inStock)
                    ->select('offers.id', 'offers.price_cents', 'offers.original_price_cents')
                    ->orderBy('offers.price_cents')
                    ->orderBy('offers.id')
                    ->limit(1),
                'best',
            )
            ->addSelect([
                'best.id as best_offer_id',
                'best.price_cents as best_price_cents',
                'best.original_price_cents as best_original_price_cents',
            ])
            ->selectSub((clone $inStock)->selectRaw('count(*)'), 'in_stock_offers_count');
    }

    /** True when at least one seller can deliver a key (needs withBestOffer()). */
    public function isInStock(): bool
    {
        return $this->best_price_cents !== null;
    }
}
