<?php

namespace App\Support;

/**
 * What a visitor typed into the search box, cleaned up once so that every
 * place that searches (the header's suggestions and the store) treats it the
 * same way.
 *
 *   "  Elden   RING "  ->  text "elden ring", words ["elden", "ring"]
 *
 * Nothing here is trusted as SQL: the values are only ever passed to the
 * database as bound parameters, and likePattern() neutralises the characters
 * that have a special meaning inside LIKE.
 */
class SearchTerm
{
    /** Longer input is rejected by validation before it gets here. */
    public const MAX_LENGTH = 80;

    /** More words than this add cost without making a search more precise. */
    public const MAX_WORDS = 6;

    /** The header only asks for suggestions from this many characters on. */
    public const SUGGESTIONS_MIN_LENGTH = 2;

    /**
     * @param  list<string>  $words
     */
    private function __construct(public readonly string $text, public readonly array $words) {}

    /** Null when there is nothing to search for (missing, empty, only spaces). */
    public static function from(?string $input): ?self
    {
        // Drop control characters, fold whitespace runs into one space.
        $text = trim(preg_replace('/\s+/u', ' ', preg_replace('/[\p{Cc}\p{Cf}]/u', ' ', (string) $input) ?? '') ?? '');
        $text = mb_strtolower(mb_substr($text, 0, self::MAX_LENGTH));

        if ($text === '') {
            return null;
        }

        return new self($text, array_slice(array_values(array_unique(explode(' ', $text))), 0, self::MAX_WORDS));
    }

    /**
     * $value made safe to place inside a LIKE pattern: "%", "_" and "\" are
     * matched as themselves instead of acting as wildcards. Without this, a
     * search for "%" would match every product.
     */
    public static function likePattern(string $value): string
    {
        return addcslashes($value, '\\%_');
    }
}
