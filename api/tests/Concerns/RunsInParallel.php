<?php

namespace Tests\Concerns;

use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Runs several pieces of work at the same moment, each in its own operating
 * system process with its own database connection: the closest a test can
 * get to several buyers pressing a button together.
 *
 * Tests using this must rebuild the schema (DatabaseMigrations) instead of
 * wrapping the test in a transaction, because the other processes can only
 * see data that was really committed.
 */
trait RunsInParallel
{
    /**
     * @param  list<callable(): mixed>  $tasks
     * @return list<mixed> what each task returned, in the order given; a task
     *                     that threw gives ['exception' => class, 'message' => text]
     */
    protected function inParallel(array $tasks): array
    {
        // Each process must open its own connection; a shared one would mix
        // up their conversations with the database.
        DB::disconnect();

        $directory = sys_get_temp_dir().'/parallel-'.bin2hex(random_bytes(6));
        mkdir($directory);
        // All processes wait for the same instant, so they really do collide.
        $start = microtime(true) + 0.4;
        $children = [];

        foreach ($tasks as $index => $task) {
            $pid = pcntl_fork();

            if ($pid === 0) {
                DB::purge();
                time_sleep_until($start);

                try {
                    $result = $task();
                } catch (Throwable $exception) {
                    $result = ['exception' => $exception::class, 'message' => $exception->getMessage()];
                }

                file_put_contents("{$directory}/{$index}.json", json_encode($result));
                // Leave at once, without running the test runner's own
                // shutdown code a second time in this copy of the process.
                posix_kill(posix_getpid(), SIGKILL);
            }

            $children[] = $pid;
        }

        foreach ($children as $pid) {
            pcntl_waitpid($pid, $status);
        }

        $results = [];
        foreach (array_keys($tasks) as $index) {
            $file = "{$directory}/{$index}.json";
            $results[] = is_file($file) ? json_decode(file_get_contents($file), true) : ['exception' => 'ProcessDied', 'message' => 'The process wrote no result.'];
            @unlink($file);
        }
        rmdir($directory);

        DB::reconnect();

        return $results;
    }
}
