<?php

namespace Tests\Feature\Schema;

use App\Enums\LicenseKeyStatus;
use App\Models\LicenseKey;
use App\Models\Offer;
use App\Models\OrderItem;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\AssertsDatabaseConstraints;
use Tests\TestCase;

class LicenseKeySchemaTest extends TestCase
{
    use AssertsDatabaseConstraints, RefreshDatabase;

    public function test_stock_is_the_number_of_available_keys(): void
    {
        $offer = Offer::factory()->create();
        $item = OrderItem::factory()->for($offer)->create();

        LicenseKey::factory()->count(3)->for($offer)->create();
        LicenseKey::factory()->reservedFor($item)->create();
        LicenseKey::factory()->soldTo($item)->create();

        $this->assertSame(5, $offer->licenseKeys()->count());
        $this->assertSame(3, $offer->licenseKeys()->where('status', LicenseKeyStatus::Available)->count());
        $this->assertCount(2, $item->licenseKeys);
    }

    public function test_the_same_key_code_cannot_exist_twice(): void
    {
        LicenseKey::factory()->create(['code' => 'AAAAA-BBBBB-CCCCC']);

        $this->assertViolatesConstraint(
            'license_keys_code_unique',
            fn () => LicenseKey::factory()->create(['code' => 'AAAAA-BBBBB-CCCCC']),
        );
    }

    public function test_an_available_key_cannot_be_attached_to_an_order(): void
    {
        $item = OrderItem::factory()->create();

        $this->assertViolatesConstraint(
            'license_keys_state_check',
            fn () => LicenseKey::factory()->create(['order_item_id' => $item->id]),
        );
    }

    public function test_a_key_cannot_be_sold_without_an_order_line(): void
    {
        $key = LicenseKey::factory()->create();

        $this->assertViolatesConstraint(
            'license_keys_state_check',
            fn () => $key->update(['status' => LicenseKeyStatus::Sold, 'sold_at' => now()]),
        );
    }

    public function test_a_reservation_must_have_an_expiry_time(): void
    {
        $key = LicenseKey::factory()->create();
        $item = OrderItem::factory()->create();

        $this->assertViolatesConstraint(
            'license_keys_state_check',
            fn () => $key->update(['status' => LicenseKeyStatus::Reserved, 'order_item_id' => $item->id]),
        );
    }

    public function test_a_key_can_move_from_available_to_reserved_to_sold_and_back_to_available(): void
    {
        $key = LicenseKey::factory()->create();
        $item = OrderItem::factory()->for($key->offer)->create();

        $key->update([
            'status' => LicenseKeyStatus::Reserved,
            'order_item_id' => $item->id,
            'reserved_until' => now()->addMinutes(15),
        ]);
        $this->assertSame(LicenseKeyStatus::Reserved, $key->fresh()->status);

        // Released (payment declined or reservation expired).
        $key->update(['status' => LicenseKeyStatus::Available, 'order_item_id' => null, 'reserved_until' => null]);
        $this->assertSame(LicenseKeyStatus::Available, $key->fresh()->status);

        // Reserved again, then paid for.
        $key->update([
            'status' => LicenseKeyStatus::Reserved,
            'order_item_id' => $item->id,
            'reserved_until' => now()->addMinutes(15),
        ]);
        $key->update(['status' => LicenseKeyStatus::Sold, 'sold_at' => now()]);
        $this->assertSame(LicenseKeyStatus::Sold, $key->fresh()->status);
    }

    public function test_key_codes_are_hidden_from_json_by_default(): void
    {
        $key = LicenseKey::factory()->create(['code' => 'SECRET-SECRET-SECRET']);

        $this->assertArrayNotHasKey('code', $key->toArray());
        $this->assertStringNotContainsString('SECRET', $key->toJson());
    }
}
