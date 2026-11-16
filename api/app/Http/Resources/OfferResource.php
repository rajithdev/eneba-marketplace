<?php

namespace App\Http\Resources;

use App\Models\Offer;
use App\Support\Price;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One seller's offer on a product page. Expects the seller loaded and the
 * `in_stock` flag added by the query. Never includes key codes or counts.
 *
 * @mixin Offer
 */
class OfferResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            // What the cart will refer to when the buyer picks this seller.
            'id' => $this->id,
            'seller' => [
                'slug' => $this->seller->slug,
                'name' => $this->seller->name,
                'rating_percent' => (float) $this->seller->rating_percent,
                'sales_count' => $this->seller->sales_count,
            ],
            'price' => Price::toArray($this->price_cents, $this->original_price_cents),
            'in_stock' => (bool) $this->in_stock,
        ];
    }
}
