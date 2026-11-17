<?php

namespace Tests\Concerns;

/**
 * Keeps the API and the frontend agreed on the shape of each response.
 *
 * web/src/contracts holds one example response per endpoint. A test that
 * uses this trait fails if the API stops returning exactly that. The
 * frontend's TypeScript types are checked against the same files, so a
 * change on either side that the other has not followed breaks a build
 * instead of a page.
 *
 * To accept an intended change, regenerate the files and review the diff:
 *
 *     make contracts
 */
trait ChecksContracts
{
    /**
     * @param  string  $file  the example's file name in web/src/contracts
     * @param  string  $request  what was asked, e.g. "GET /api/filters"
     * @param  array<string, mixed>  $response  the decoded JSON that came back
     */
    protected function assertMatchesExample(string $file, string $request, array $response): void
    {
        // Where docker-compose.yml mounts web/src/contracts.
        $directory = '/var/www/contracts';
        $this->assertDirectoryExists($directory, 'web/src/contracts is not mounted into the container.');

        $example = ['request' => $request, 'response' => $response];
        $path = "{$directory}/{$file}";

        if (env('UPDATE_CONTRACTS')) {
            file_put_contents($path, json_encode($example, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n");
        }

        $this->assertFileExists($path, "Missing example {$file}. Run: make contracts");
        $this->assertSame(
            json_decode(file_get_contents($path), true),
            $example,
            "The response of [{$request}] no longer matches web/src/contracts/{$file}. ".
            'If the change is intended, run "make contracts" and review the diff.',
        );
    }
}
