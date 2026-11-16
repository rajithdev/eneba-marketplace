<?php

namespace App\Support;

/**
 * The one shape in which the API reports a price.
 *
 * Amounts are whole cents (integers), never decimals: 29.99 is 2999. The
 * frontend only formats them. The store currently sells in one currency.
 */
class Price
{
    public const CURRENCY = 'EUR';

    /**
     * @return array{amount_cents: int, currency: string, original_amount_cents: int|null, discount_percent: int|null}|null
     *                                                                                                                      null when there is nothing to sell
     */
    public static function toArray(?int $cents, ?int $originalCents): ?array
    {
        if ($cents === null) {
            return null;
        }

        $discounted = $originalCents !== null && $originalCents > $cents;

        return [
            'amount_cents' => $cents,
            'currency' => self::CURRENCY,
            // The struck-through "was" price, and how much lower the current one is.
            'original_amount_cents' => $discounted ? $originalCents : null,
            'discount_percent' => $discounted ? (int) round(($originalCents - $cents) / $originalCents * 100) : null,
        ];
    }
}
