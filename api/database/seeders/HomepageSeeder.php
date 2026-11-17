<?php

namespace Database\Seeders;

use App\Models\Banner;
use App\Models\HomepageBlock;
use Illuminate\Database\Seeder;

/**
 * The starting homepage: the layout in database/data/homepage.json.
 *
 * It only ever fills an EMPTY layout. Once blocks or banners exist, this
 * leaves them exactly as they are, so a block that was reordered, hidden or
 * retitled in the database stays that way through every later deployment.
 */
class HomepageSeeder extends Seeder
{
    public function run(): void
    {
        $homepage = json_decode(file_get_contents(database_path('data/homepage.json')), true, flags: JSON_THROW_ON_ERROR);

        if (HomepageBlock::query()->doesntExist()) {
            foreach ($homepage['blocks'] as $block) {
                HomepageBlock::create($block);
            }
        }

        if (Banner::query()->doesntExist()) {
            foreach ($homepage['banners'] as $banner) {
                Banner::create($banner);
            }
        }
    }
}
