<?php

namespace Tests\Feature\Catalog;

use Database\Seeders\CatalogSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * Keeps the API and the frontend agreed on the shape of each response.
 *
 * web/src/contracts holds one example response per catalog endpoint, produced
 * from the seeded catalog. This test fails if the API stops returning exactly
 * that. The frontend's TypeScript types are checked against the same files,
 * so a change on either side that the other has not followed breaks a build
 * instead of a page.
 *
 * To accept an intended change, regenerate the files and review the diff:
 *
 *     make contracts
 */
class CatalogContractTest extends TestCase
{
    use RefreshDatabase;

    /** Where docker-compose.yml mounts web/src/contracts. */
    private const DIRECTORY = '/var/www/contracts';

    private const EXAMPLES = [
        // A list that includes a discount, a full-price item and a sold-out one.
        'products.list.json' => '/api/products?platform=ea-app&sort=price_asc',
        'products.show.json' => '/api/products/elden-ring-steam-key-global',
        'filters.json' => '/api/filters',
    ];

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(CatalogSeeder::class);
    }

    public function test_every_catalog_endpoint_returns_exactly_its_recorded_example(): void
    {
        $this->assertDirectoryExists(self::DIRECTORY, 'web/src/contracts is not mounted into the container.');

        foreach (self::EXAMPLES as $file => $url) {
            $example = [
                'request' => "GET {$url}",
                'response' => $this->withStableIds($this->getJson($url)->assertOk()->json()),
            ];
            $path = self::DIRECTORY.'/'.$file;

            if (env('UPDATE_CONTRACTS')) {
                file_put_contents($path, json_encode($example, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");
            }

            $this->assertFileExists($path, "Missing example {$file}. Run: make contracts");
            $this->assertSame(
                json_decode(file_get_contents($path), true),
                $example,
                "The response of {$url} no longer matches web/src/contracts/{$file}. ".
                'If the change is intended, run "make contracts" and review the diff.',
            );
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
