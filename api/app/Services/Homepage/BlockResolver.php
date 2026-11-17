<?php

namespace App\Services\Homepage;

use App\Models\HomepageBlock;

/**
 * Fills one type of homepage block with content from its own source.
 *
 * The homepage_blocks table says which blocks the homepage has and in what
 * order; a resolver says what goes inside one. Adding a new kind of block
 * means writing one class like this and listing it in BuildHomepage.
 */
interface BlockResolver
{
    /**
     * The block's content, or null when there is nothing to show (the block
     * is then left out of the homepage instead of appearing empty).
     *
     * @return array<string, mixed>|null
     */
    public function resolve(HomepageBlock $block): ?array;
}
