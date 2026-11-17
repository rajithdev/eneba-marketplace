<?php

namespace App\Support;

/**
 * Tells a path inside this site ("/store?type=dlc") apart from anything
 * that could lead somewhere else. Links that come out of the database are
 * only sent to the browser if they pass this, so a row can never turn a
 * homepage button into a link to another site or a script.
 */
class InternalPath
{
    public static function isSafe(mixed $value): bool
    {
        return is_string($value)
            // One leading slash: "//host" and "/\host" are other sites to a browser.
            && preg_match('#^/(?![/\\\\])#', $value) === 1
            && ! str_contains($value, '\\')
            // No control characters or spaces hiding something.
            && preg_match('/[\x00-\x20\x7f]/', $value) === 0;
    }
}
