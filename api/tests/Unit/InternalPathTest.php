<?php

namespace Tests\Unit;

use App\Support\InternalPath;
use PHPUnit\Framework\TestCase;

class InternalPathTest extends TestCase
{
    public function test_paths_inside_the_site_are_accepted(): void
    {
        foreach (['/', '/store', '/store?type=gift_card&sort=price_asc', '/product/elden-ring-steam-key-global', '/covers/a.svg'] as $path) {
            $this->assertTrue(InternalPath::isSafe($path), $path);
        }
    }

    public function test_anything_that_could_lead_elsewhere_is_refused(): void
    {
        foreach (['https://evil.example', 'http://evil.example/', '//evil.example', '/\\evil.example', '\\\\evil.example', 'javascript:alert(1)', 'data:text/html,x', 'store', '', ' /store', "/store\n", '/a b', null, 42, ['/store']] as $value) {
            $this->assertFalse(InternalPath::isSafe($value), var_export($value, true));
        }
    }
}
