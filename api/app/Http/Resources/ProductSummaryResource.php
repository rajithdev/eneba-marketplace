<?php

namespace App\Http\Resources;

use App\Models\Product;
use App\Support\Price;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A product as it appears on a card in the store, and in a product page's
 * list of other variants. Expects the product loaded with withBestOffer()
 * and its game, platform and region.
 *
 * @mixin Product
 */
class ProductSummaryResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'slug' => $this->slug,
            'name' => $this->name,
            'type' => $this->game->type->value,
            'cover_image_url' => $this->game->cover_image_url,
            'release_date' => $this->game->release_date?->toDateString(),
            'platform' => ['slug' => $this->platform->slug, 'name' => $this->platform->name],
            'region' => ['slug' => $this->region->slug, 'name' => $this->region->name],
            // False means every seller is out of keys: shown as "Sold out".
            'in_stock' => $this->isInStock(),
            // The cheapest price a buyer can actually pay now; null when sold out.
            'price' => Price::toArray($this->best_price_cents, $this->best_original_price_cents),
            // How many sellers can deliver a key right now.
            'offers_count' => $this->in_stock_offers_count,
        ];
    }
}
