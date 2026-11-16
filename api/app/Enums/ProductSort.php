<?php

namespace App\Enums;

/**
 * The orderings the store offers. Apart from Relevance, sold-out products
 * always come last.
 */
enum ProductSort: string
{
    /** Only meaningful with a search term; the default when there is one. */
    case Relevance = 'relevance';
    case Popular = 'popular';
    case PriceAsc = 'price_asc';
    case PriceDesc = 'price_desc';
    case Newest = 'newest';

    public const DEFAULT = self::Popular;

    /**
     * The orderings that work without a search term, for the store's menu.
     *
     * @return list<self>
     */
    public static function withoutSearch(): array
    {
        return array_values(array_filter(self::cases(), fn (self $sort) => $sort !== self::Relevance));
    }

    /** Name shown in the store's sort menu. */
    public function label(): string
    {
        return match ($this) {
            self::Relevance => 'Best match',
            self::Popular => 'Most popular',
            self::PriceAsc => 'Price: low to high',
            self::PriceDesc => 'Price: high to low',
            self::Newest => 'Newest releases',
        };
    }
}
