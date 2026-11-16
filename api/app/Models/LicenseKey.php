<?php

namespace App\Models;

use App\Enums\LicenseKeyStatus;
use Database\Factories\LicenseKeyFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One digital key: a single unit of an offer's stock.
 *
 * `code` is hidden from JSON by default so a key can never leak through a
 * catalog response; the order endpoints expose it explicitly to its buyer.
 */
#[Fillable(['offer_id', 'code', 'status', 'order_item_id', 'reserved_until', 'sold_at'])]
#[Hidden(['code'])]
class LicenseKey extends Model
{
    /** @use HasFactory<LicenseKeyFactory> */
    use HasFactory;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => LicenseKeyStatus::class,
            'reserved_until' => 'datetime',
            'sold_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Offer, $this> */
    public function offer(): BelongsTo
    {
        return $this->belongsTo(Offer::class);
    }

    /** @return BelongsTo<OrderItem, $this> */
    public function orderItem(): BelongsTo
    {
        return $this->belongsTo(OrderItem::class);
    }
}
