<?php

namespace App\Models;

use Database\Factories\SellerFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A merchant on the marketplace. Sellers are catalog data in this project:
 * they do not log in or manage their own offers (see docs/ARCHITECTURE.md, "Scope").
 */
#[Fillable(['name', 'slug', 'rating_percent', 'sales_count'])]
class Seller extends Model
{
    /** @use HasFactory<SellerFactory> */
    use HasFactory;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'rating_percent' => 'decimal:2',
            'sales_count' => 'integer',
        ];
    }

    /** @return HasMany<Offer, $this> */
    public function offers(): HasMany
    {
        return $this->hasMany(Offer::class);
    }
}
