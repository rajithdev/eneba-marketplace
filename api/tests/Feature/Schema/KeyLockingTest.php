<?php

namespace Tests\Feature\Schema;

use App\Models\LicenseKey;
use App\Models\Offer;
use Illuminate\Foundation\Testing\DatabaseMigrations;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * Proves the database mechanism the checkout relies on for concurrent
 * purchases: two buyers reading stock at the same moment are never handed
 * the same key, and neither waits for the other.
 *
 * This uses two real database connections, so it cannot run inside the
 * single wrapping transaction that RefreshDatabase uses; the schema is
 * rebuilt for this test instead.
 */
class KeyLockingTest extends TestCase
{
    use DatabaseMigrations;

    protected function setUp(): void
    {
        parent::setUp();

        // A second, independent connection to the same database: "buyer B".
        config(['database.connections.buyer_b' => config('database.connections.pgsql')]);
    }

    protected function tearDown(): void
    {
        DB::connection('buyer_b')->rollBack();
        DB::connection('pgsql')->rollBack();
        DB::purge('buyer_b');

        parent::tearDown();
    }

    public function test_two_simultaneous_buyers_are_never_given_the_same_key(): void
    {
        $offer = Offer::factory()->create();
        LicenseKey::factory()->count(2)->for($offer)->create();

        $buyerA = DB::connection('pgsql');
        $buyerB = DB::connection('buyer_b');
        $buyerA->beginTransaction();
        $buyerB->beginTransaction();

        $keysForA = $this->lockAvailableKeys($buyerA, $offer->id, 1);
        // B asks for two keys while A's transaction is still open.
        $keysForB = $this->lockAvailableKeys($buyerB, $offer->id, 2);

        $this->assertCount(1, $keysForA);
        $this->assertCount(1, $keysForB, 'B must get only the key A did not lock, without waiting.');
        $this->assertNotEquals($keysForA, $keysForB);
    }

    public function test_the_last_key_goes_to_exactly_one_buyer(): void
    {
        $offer = Offer::factory()->create();
        LicenseKey::factory()->for($offer)->create();

        $buyerA = DB::connection('pgsql');
        $buyerB = DB::connection('buyer_b');
        $buyerA->beginTransaction();
        $buyerB->beginTransaction();

        $this->assertCount(1, $this->lockAvailableKeys($buyerA, $offer->id, 1));
        $this->assertCount(0, $this->lockAvailableKeys($buyerB, $offer->id, 1));
    }

    /** @return list<int> ids of the keys this connection now holds locked */
    private function lockAvailableKeys($connection, int $offerId, int $quantity): array
    {
        $rows = $connection->select(
            "SELECT id FROM license_keys
              WHERE offer_id = ? AND status = 'available'
              ORDER BY id
              LIMIT ?
              FOR UPDATE SKIP LOCKED",
            [$offerId, $quantity],
        );

        return array_map(fn ($row) => $row->id, $rows);
    }
}
