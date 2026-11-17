<?php

namespace Tests\Feature\Catalog;

use Database\Seeders\CatalogSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\ChecksContracts;
use Tests\TestCase;

/** The catalog's example responses (see ChecksContracts). */
class CatalogContractTest extends TestCase
{
    use ChecksContracts, RefreshDatabase;

    private const EXAMPLES = [
        // A list that includes a discount, a full-price item and a sold-out one.
        'products.list.json' => '/api/products?platform=ea-app&sort=price_asc',
        'products.show.json' => '/api/products/elden-ring-steam-key-global',
        'filters.json' => '/api/filters',
        // A misspelt search: the same product shape as the list, best match first.
        'search.suggestions.json' => '/api/search/suggestions?q=eldn+ring',
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(CatalogSeeder::class);
    }

    public function test_every_catalog_endpoint_returns_exactly_its_recorded_example(): void
    {
        foreach (self::EXAMPLES as $file => $url) {
            $this->assertMatchesExample($file, "GET {$url}", $this->withStableIds($this->getJson($url)->assertOk()->json()));
        }
    }

    /**
     * Database ids depend on what was inserted before, so they are not part of
     * the contract. Each "id" is replaced by its position in its list (1, 2,
     * 3, ...), after checking it really is a positive whole number.
     */
    private function withStableIds(array $value): array
    {
        foreach ($value as $key => $item) {
            if (! is_array($item)) {
                continue;
            }

            if (array_is_list($item)) {
                foreach ($item as $position => $entry) {
                    if (is_array($entry) && array_key_exists('id', $entry)) {
                        $this->assertIsInt($entry['id']);
                        $this->assertGreaterThan(0, $entry['id']);
                        $item[$position]['id'] = $position + 1;
                    }
                }
            }

            $value[$key] = $this->withStableIds($item);
        }

        return $value;
    }
}
