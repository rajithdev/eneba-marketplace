<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** One row of the homepage layout: which block, where, and its settings. */
#[Fillable(['type', 'title', 'position', 'config', 'is_active'])]
class HomepageBlock extends Model
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'config' => 'array',
            'position' => 'integer',
            'is_active' => 'boolean',
        ];
    }
}
