<?php

namespace App\Models;

use App\Enums\GameType;
use App\Support\FuzzySearch;
use App\Support\SearchTerm;
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

    /**
     * Keeps only products whose name matches what the visitor typed, and adds
     * two columns used to rank them:
     *
     *   search_tier   0 the whole name (or the game's title) is the term
     *                 1 the name starts with the term
     *                 2 every word of the term appears in the name
     *                 3 at least one word matched only as a near miss (a typo)
     *   search_score  how closely the term resembles the name, 0 to 1
     *
     * Each word of the term must match on its own, so "ring elden" finds
     * Elden Ring. A word of one or two letters only counts at the start of a
     * word in the name ("fc" finds "EA Sports FC 25" but not "traffic"), and
     * typo tolerance starts at three letters: shorter fragments resemble too
     * many things.
     *
     * The query must join `games` and run inside FuzzySearch::run(), which
     * sets the typo threshold the "<%" operator uses.
     *
     * @param  Builder<Product>  $query
     */
    public function scopeSearch(Builder $query, SearchTerm $term): void
    {
        $everyWordAppears = [];
        $bindingsForAppears = [];

        foreach ($term->words as $word) {
            $like = SearchTerm::likePattern($word);

            if (mb_strlen($word) < 3) {
                $appears = '(products.name ILIKE ? OR products.name ILIKE ?)';
                $appearsBindings = ["{$like}%", "% {$like}%"];
            } else {
                $appears = 'products.name ILIKE ?';
                $appearsBindings = ["%{$like}%"];
            }

            $everyWordAppears[] = $appears;
            array_push($bindingsForAppears, ...$appearsBindings);

            // The word is in the name, or (from three letters) is a near miss
            // of a word in it. "<%" is what lets PostgreSQL use the trigram
            // index; the explicit score check keeps the result correct even
            // if the threshold setting were ever missing.
            if (mb_strlen($word) < 3) {
                $query->whereRaw($appears, $appearsBindings);
            } else {
                $query->whereRaw(
                    "({$appears} OR (? <% products.name AND word_similarity(?, products.name) >= ?))",
                    [...$appearsBindings, $word, $word, FuzzySearch::THRESHOLD],
                );
            }
        }

        $query
            ->selectRaw(
                'CASE
                    WHEN lower(products.name) = ? OR lower(games.title) = ? THEN 0
                    WHEN products.name ILIKE ? THEN 1
                    WHEN '.implode(' AND ', $everyWordAppears).' THEN 2
                    ELSE 3
                 END AS search_tier',
                [$term->text, $term->text, SearchTerm::likePattern($term->text).'%', ...$bindingsForAppears],
            )
            ->selectRaw('word_similarity(?, products.name) AS search_score', [$term->text]);
    }

    /**
     * Best match first: by tier, then by how closely the name resembles the
     * term, then products that can be bought before sold-out ones, then the
     * more popular. Needs search() and withBestOffer().
     *
     * @param  Builder<Product>  $query
     */
    public function scopeOrderByRelevance(Builder $query): void
    {
        $query
            ->orderBy('search_tier')
            ->orderByDesc('search_score')
            ->orderByRaw('best.price_cents IS NULL')
            ->orderByDesc('products.sales_count');
    }

    /** True when at least one seller can deliver a key (needs withBestOffer()). */
    public function isInStock(): bool
    {
        return $this->best_price_cents !== null;
    }
}
