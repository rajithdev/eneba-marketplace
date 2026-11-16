<?php

namespace App\Models;

use App\Enums\LicenseKeyStatus;
use Database\Factories\OfferFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One seller's price for one product. Its stock is the number of
 * available license keys attached to it; there is no stock column.
 */
#[Fillable(['product_id', 'seller_id', 'price_cents', 'original_price_cents', 'currency', 'is_active'])]
class Offer extends Model
{
    /** @use HasFactory<OfferFactory> */
    use HasFactory;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'price_cents' => 'integer',
            'original_price_cents' => 'integer',
            'is_active' => 'boolean',
            // Present only when loaded with withExists(... as in_stock).
            'in_stock' => 'boolean',
        ];
    }

    /**
     * Offers a buyer can actually purchase right now: switched on by the
     * seller, and with at least one key that is neither reserved nor sold.
     * This one definition is used everywhere a price or "in stock" is shown.
     *
     * @param  Builder<Offer>  $query
     */
    public function scopeSellable(Builder $query): void
    {
        $query->where('offers.is_active', true)->whereExists(
            LicenseKey::query()
                ->selectRaw('1')
                ->whereColumn('license_keys.offer_id', 'offers.id')
                ->where('license_keys.status', LicenseKeyStatus::Available->value),
        );
    }

    /** @return BelongsTo<Product, $this> */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /** @return BelongsTo<Seller, $this> */
    public function seller(): BelongsTo
    {
        return $this->belongsTo(Seller::class);
    }

    /** @return HasMany<LicenseKey, $this> */
    public function licenseKeys(): HasMany
    {
        return $this->hasMany(LicenseKey::class);
    }
}
