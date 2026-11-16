<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

/** Content for the homepage hero banner block. */
#[Fillable(['title', 'subtitle', 'image_url', 'link_url', 'cta_label', 'position', 'is_active'])]
class Banner extends Model
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'position' => 'integer',
            'is_active' => 'boolean',
        ];
    }
}
