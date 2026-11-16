<?php

namespace App\Enums;

/** The orderings the store offers. Sold-out products always come last. */
enum ProductSort: string
{
    case Popular = 'popular';
    case PriceAsc = 'price_asc';
    case PriceDesc = 'price_desc';
    case Newest = 'newest';

    public const DEFAULT = self::Popular;

    /** Name shown in the store's sort menu. */
    public function label(): string
    {
        return match ($this) {
            self::Popular => 'Most popular',
            self::PriceAsc => 'Price: low to high',
            self::PriceDesc => 'Price: high to low',
            self::Newest => 'Newest releases',
        };
    }
}
