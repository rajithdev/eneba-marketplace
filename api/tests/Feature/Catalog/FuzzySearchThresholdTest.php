<?php

namespace Tests\Feature\Catalog;

use App\Support\FuzzySearch;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * The typo threshold is a database setting. It must apply to a search and
 * then be gone, because the same connection may serve an unrelated request
 * next. (This cannot be checked inside the single wrapping transaction that
 * most tests run in, so the schema is rebuilt for it instead.)
 */
class FuzzySearchThresholdTest extends TestCase
{
    use DatabaseMigrations;

    private function threshold(): float
    {
        return (float) DB::selectOne('SHOW pg_trgm.word_similarity_threshold')->{'pg_trgm.word_similarity_threshold'};
    }

    public function test_the_threshold_applies_during_a_search_and_is_restored_afterwards(): void
    {
        $this->assertSame(0.6, $this->threshold(), 'the database default');

        $during = FuzzySearch::run(fn () => $this->threshold());

        $this->assertSame(FuzzySearch::THRESHOLD, $during);
        $this->assertSame(0.6, $this->threshold(), 'the setting leaked out of the search');
    }

    public function test_the_threshold_is_restored_even_when_the_search_fails(): void
    {
        try {
            FuzzySearch::run(fn () => throw new \RuntimeException('query failed'));
        } catch (\RuntimeException) {
            // expected
        }

        $this->assertSame(0.6, $this->threshold());
    }
}
