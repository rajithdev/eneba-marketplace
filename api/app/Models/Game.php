<?php

namespace App\Models;

use App\Enums\GameType;
use Database\Factories\GameFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A title in the catalog: the game itself (or a DLC, gift card or
 * subscription), independent of where it is sold. Everything that is the
 * same for all of its variants lives here once.
 */
#[Fillable(['slug', 'title', 'description', 'cover_image_url', 'type', 'release_date'])]
class Game extends Model
{
    /** @use HasFactory<GameFactory> */
    use HasFactory;

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'type' => GameType::class,
            'release_date' => 'date',
        ];
    }

    /**
     * The sellable variants: one per platform and region.
     *
     * @return HasMany<Product, $this>
     */
    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }
}
