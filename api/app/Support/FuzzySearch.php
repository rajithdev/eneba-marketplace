<?php

namespace App\Support;

use Closure;
use Illuminate\Support\Facades\DB;

/**
 * Typo tolerance, tuned in one place.
 *
 * PostgreSQL's pg_trgm compares words by the three-letter pieces they share
 * and gives a score from 0 to 1. Its "<%" operator (which can use the trigram
 * index) counts a word as matching when the score reaches a threshold that
 * is a database setting, 0.6 by default.
 *
 * Measured on this catalog: 0.6 misses ordinary one-letter slips ("mincraft"
 * scores 0.58, "sekro" 0.50), 0.5 catches them without false matches, and 0.4
 * starts matching unrelated titles. So searches run with 0.5.
 */
class FuzzySearch
{
    public const THRESHOLD = 0.5;

    /**
     * Run search queries with the threshold applied. "SET LOCAL" lasts only
     * until the surrounding transaction ends, so the setting can never leak
     * into another request that later reuses the same database connection.
     *
     * @template T
     *
     * @param  Closure(): T  $queries
     * @return T
     */
    public static function run(Closure $queries): mixed
    {
        return DB::transaction(function () use ($queries) {
            // A constant, not input: safe to place in the statement.
            DB::statement('SET LOCAL pg_trgm.word_similarity_threshold = '.self::THRESHOLD);

            return $queries();
        });
    }
}
