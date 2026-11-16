<?php

namespace Database\Factories;

use App\Enums\GameType;
use App\Models\Game;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * @extends Factory<Game>
 */
class GameFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        $title = Str::title(fake()->unique()->words(3, true));

        return [
            'slug' => Str::slug($title),
            'title' => $title,
            'description' => fake()->paragraph(),
            'cover_image_url' => '/covers/'.Str::slug($title).'.svg',
            'type' => GameType::Game,
            'release_date' => fake()->date(),
        ];
    }
}
