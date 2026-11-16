<?php

namespace Tests\Concerns;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

trait AssertsDatabaseConstraints
{
    /**
     * Assert that the database itself rejects a write, and that it was the
     * named constraint that rejected it.
     *
     * The write runs in a nested transaction (a savepoint) because PostgreSQL
     * aborts the surrounding transaction after an error, which would break
     * every later query in the same test.
     */
    protected function assertViolatesConstraint(string $constraint, callable $write): void
    {
        try {
            DB::transaction($write);
        } catch (QueryException $exception) {
            $this->assertStringContainsString($constraint, $exception->getMessage());

            return;
        }

        $this->fail("Expected the constraint [{$constraint}] to reject the write, but it was accepted.");
    }
}
