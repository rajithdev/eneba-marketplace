<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

/**
 * Checks the hand-written catalog files for mistakes that would make the
 * store look wrong: a gift card in the wrong currency region, a DLC sold
 * where its base game is not, a release date in the future, a duplicate.
 * No database is involved; this reads the JSON as written.
 */
class CatalogDataTest extends TestCase
{
    private const TYPES = ['game', 'dlc', 'gift_card', 'subscription'];

    /** Platforms a title is tied to when its name starts with one of these. */
    private const PLATFORM_BRANDS = [
        'Steam' => 'steam',
        'Xbox' => 'xbox-live',
        'PlayStation' => 'psn',
        'Nintendo' => 'nintendo',
        'EA Play' => 'ea-app',
    ];

    /** Titles published only on Nintendo's own platform. */
    private const NINTENDO_EXCLUSIVES = ['mario-kart-8-deluxe', 'the-legend-of-zelda-tears-of-the-kingdom'];

    /** @return array<int, array<string, mixed>> */
    private function games(): array
    {
        return json_decode(file_get_contents(__DIR__.'/../../database/data/games.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    /** @return array<string, array<int, array<string, mixed>>> */
    private function reference(): array
    {
        return json_decode(file_get_contents(__DIR__.'/../../database/data/reference.json'), true, flags: JSON_THROW_ON_ERROR);
    }

    public function test_every_game_has_the_required_fields_with_sensible_values(): void
    {
        foreach ($this->games() as $game) {
            $label = $game['slug'] ?? json_encode($game);

            $this->assertMatchesRegularExpression('/^[a-z0-9]+(-[a-z0-9]+)*$/', $game['slug'], $label);
            $this->assertNotSame('', trim($game['title']), $label);
            $this->assertContains($game['type'], self::TYPES, $label);
            $this->assertGreaterThanOrEqual(40, strlen($game['description']), "{$label}: description too short");
            $this->assertLessThanOrEqual(260, strlen($game['description']), "{$label}: description too long");
            $this->assertGreaterThanOrEqual(99, $game['base_price_cents'], $label);
            $this->assertLessThanOrEqual(8000, $game['base_price_cents'], $label);
            $this->assertGreaterThanOrEqual(1, $game['popularity'], $label);
            $this->assertLessThanOrEqual(100, $game['popularity'], $label);
            $this->assertNotEmpty($game['variants'], $label);
        }
    }

    public function test_slugs_and_titles_are_unique(): void
    {
        $games = $this->games();

        $this->assertSame(count($games), count(array_unique(array_column($games, 'slug'))));
        $this->assertSame(count($games), count(array_unique(array_column($games, 'title'))));
    }

    public function test_variants_use_known_platforms_and_regions_and_are_not_repeated(): void
    {
        $platforms = array_column($this->reference()['platforms'], 'slug');
        $regions = array_column($this->reference()['regions'], 'slug');

        foreach ($this->games() as $game) {
            $seen = [];
            foreach ($game['variants'] as $variant) {
                $this->assertContains($variant['platform'], $platforms, $game['slug']);
                $this->assertContains($variant['region'], $regions, $game['slug']);
                $this->assertContains($variant['stock'] ?? 'normal', ['normal', 'none'], $game['slug']);
                $seen[] = "{$variant['platform']}/{$variant['region']}";
            }
            $this->assertSame($seen, array_unique($seen), "{$game['slug']} lists a variant twice");
        }
    }

    public function test_release_dates_are_real_past_dates_and_only_games_and_dlc_have_one(): void
    {
        foreach ($this->games() as $game) {
            if (in_array($game['type'], ['gift_card', 'subscription'], true)) {
                $this->assertNull($game['release_date'], "{$game['slug']}: a {$game['type']} has no release date");

                continue;
            }

            $date = \DateTimeImmutable::createFromFormat('!Y-m-d', (string) $game['release_date']);
            $this->assertNotFalse($date, "{$game['slug']}: release date must be YYYY-MM-DD");
            $this->assertSame($game['release_date'], $date->format('Y-m-d'), "{$game['slug']}: not a real calendar date");
            $this->assertGreaterThanOrEqual('1995-01-01', $game['release_date'], $game['slug']);
            $this->assertLessThanOrEqual(date('Y-m-d'), $game['release_date'], "{$game['slug']}: release date is in the future");
        }
    }

    public function test_a_dlc_is_sold_only_where_its_base_game_is_and_not_before_it(): void
    {
        $games = collect($this->games())->keyBy('title');

        foreach ($games->where('type', 'dlc') as $dlc) {
            $baseTitle = trim(explode(':', $dlc['title'])[0]);
            $this->assertTrue($games->has($baseTitle), "{$dlc['slug']}: base game \"{$baseTitle}\" is not in the catalog");
            $base = $games[$baseTitle];

            $this->assertGreaterThanOrEqual($base['release_date'], $dlc['release_date'], "{$dlc['slug']} predates its base game");

            $baseVariants = array_map(fn ($v) => "{$v['platform']}/{$v['region']}", $base['variants']);
            foreach ($dlc['variants'] as $variant) {
                $this->assertContains(
                    "{$variant['platform']}/{$variant['region']}",
                    $baseVariants,
                    "{$dlc['slug']} is sold on {$variant['platform']}/{$variant['region']} but its base game is not",
                );
            }
        }
    }

    public function test_gift_cards_and_subscriptions_are_sold_only_on_the_platform_they_name(): void
    {
        foreach ($this->games() as $game) {
            if (! in_array($game['type'], ['gift_card', 'subscription'], true)) {
                continue;
            }

            $platform = null;
            foreach (self::PLATFORM_BRANDS as $brand => $slug) {
                if (str_starts_with($game['title'], $brand)) {
                    $platform = $slug;
                }
            }

            $this->assertNotNull($platform, "{$game['slug']}: title does not name a known platform");
            foreach ($game['variants'] as $variant) {
                $this->assertSame($platform, $variant['platform'], "{$game['slug']} must be sold on {$platform} only");
            }
        }
    }

    public function test_a_gift_card_in_a_currency_is_sold_in_the_region_that_uses_it(): void
    {
        $regionOfCurrency = ['EUR' => 'europe', 'USD' => 'united-states'];

        foreach ($this->games() as $game) {
            if ($game['type'] !== 'gift_card') {
                continue;
            }

            $this->assertMatchesRegularExpression('/ (\d+) (EUR|USD)$/', $game['title'], "{$game['slug']}: title should end with an amount and currency");
            preg_match('/ (\d+) (EUR|USD)$/', $game['title'], $match);

            foreach ($game['variants'] as $variant) {
                $this->assertSame($regionOfCurrency[$match[2]], $variant['region'], "{$game['slug']}: a {$match[2]} card belongs to {$regionOfCurrency[$match[2]]}");
            }
            // Priced near its face value (cards in USD are converted, so allow a wider band).
            $face = (int) $match[1] * 100;
            $this->assertGreaterThanOrEqual($face * 0.9, $game['base_price_cents'], $game['slug']);
            $this->assertLessThanOrEqual($face * 1.1, $game['base_price_cents'], $game['slug']);
        }
    }

    public function test_nintendo_exclusives_are_sold_only_on_nintendo(): void
    {
        $games = collect($this->games())->keyBy('slug');

        foreach (self::NINTENDO_EXCLUSIVES as $slug) {
            $this->assertTrue($games->has($slug), $slug);
            foreach ($games[$slug]['variants'] as $variant) {
                $this->assertSame('nintendo', $variant['platform'], $slug);
            }
        }
    }

    public function test_sellers_are_well_formed(): void
    {
        $sellers = $this->reference()['sellers'];

        $this->assertGreaterThanOrEqual(6, count($sellers), 'products need up to six different sellers');
        $this->assertSame(count($sellers), count(array_unique(array_column($sellers, 'slug'))));
        foreach ($sellers as $seller) {
            $this->assertGreaterThanOrEqual(0, $seller['rating_percent']);
            $this->assertLessThanOrEqual(100, $seller['rating_percent']);
        }
    }
}
