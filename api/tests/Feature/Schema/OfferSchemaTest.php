<?php

namespace Tests\Feature\Schema;

use App\Models\Offer;
use App\Models\Product;
use App\Models\Seller;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\Concerns\AssertsDatabaseConstraints;
use Tests\TestCase;

class OfferSchemaTest extends TestCase
{
    use AssertsDatabaseConstraints, RefreshDatabase;

    public function test_several_sellers_can_offer_the_same_product(): void
    {
        $product = Product::factory()->create();

        Offer::factory()->count(3)->for($product)->create();

        $this->assertCount(3, $product->offers);
        $this->assertCount(3, $product->offers->pluck('seller_id')->unique());
    }

    public function test_a_seller_can_have_only_one_offer_per_product(): void
    {
        $product = Product::factory()->create();
        $seller = Seller::factory()->create();
        Offer::factory()->for($product)->for($seller)->create();

        $this->assertViolatesConstraint(
            'offers_product_id_seller_id_unique',
            fn () => Offer::factory()->for($product)->for($seller)->create(),
        );
    }

    public function test_price_must_be_positive(): void
    {
        $this->assertViolatesConstraint(
            'offers_price_cents_check',
            fn () => Offer::factory()->create(['price_cents' => 0]),
        );
    }

    public function test_original_price_cannot_be_lower_than_the_current_price(): void
    {
        $this->assertViolatesConstraint(
            'offers_original_price_check',
            fn () => Offer::factory()->create(['price_cents' => 2000, 'original_price_cents' => 1500]),
        );
    }

    public function test_discounted_offer_keeps_a_higher_original_price(): void
    {
        $offer = Offer::factory()->state(['price_cents' => 1000])->discounted(50)->create();

        $this->assertSame(2000, $offer->original_price_cents);
    }

    public function test_seller_rating_must_be_a_percentage(): void
    {
        $this->assertViolatesConstraint(
            'sellers_rating_percent_check',
            fn () => Seller::factory()->create(['rating_percent' => 100.01]),
        );
    }
}
