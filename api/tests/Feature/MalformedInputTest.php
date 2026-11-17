<?php

namespace Tests\Feature;

use App\Models\Platform;
use App\Models\Product;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\DataProvider;
use Tests\TestCase;

/**
 * Input no browser would send (a script, a scanner, a mangled link) must
 * get a controlled "your request is wrong" answer, never a server error.
 * Each case here used to answer 500.
 */
class MalformedInputTest extends TestCase
{
    use RefreshDatabase;

    /** @return array<string, array{string, string}> */
    public static function productListQueries(): array
    {
        return [
            'a minimum price larger than the price column can hold' => ['min_price=3000000000', 'min_price'],
            'a maximum price larger than the price column can hold' => ['max_price=3000000000', 'max_price'],
            'a platform that is not valid text' => ['platform=%FF', 'query'],
            'a region that is not valid text' => ['region=steam,%C3%28', 'query'],
            'a product type that is not valid text' => ['type=%FF', 'query'],
            'a parameter name that is not valid text' => ['%FF=1', 'query'],
            'a platform that is not shaped like a slug' => ['platform=Steam%20Store', 'platform.0'],
            'more product types than exist' => ['type='.implode(',', array_fill(0, 21, 'game')), 'type'],
        ];
    }

    #[DataProvider('productListQueries')]
    public function test_the_product_list_rejects_it_with_422(string $query, string $field): void
    {
        Platform::factory()->create(['slug' => 'steam']);
        Product::factory()->pricedAt(1000)->create();

        $this->getJson("/api/products?{$query}")
            ->assertStatus(422)
            ->assertJsonValidationErrors($field);
    }

    public function test_the_largest_price_the_column_can_hold_is_still_accepted(): void
    {
        Product::factory()->pricedAt(1000)->create();

        $this->getJson('/api/products?min_price=0&max_price=2147483647')->assertOk()->assertJsonPath('meta.total', 1);
    }

    public function test_search_text_that_is_not_valid_text_finds_nothing_rather_than_failing(): void
    {
        Product::factory()->pricedAt(1000)->create();

        $this->getJson('/api/search/suggestions?q=%FF%FF')->assertOk()->assertJsonPath('data', []);
    }

    public function test_sign_in_with_an_email_that_is_not_text_is_a_validation_error(): void
    {
        $this->withHeader('Origin', config('app.frontend_url'))
            ->postJson('/api/auth/login', ['email' => ['a@example.com'], 'password' => 'whatever-it-is'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('email');

        $this->withHeader('Origin', config('app.frontend_url'))
            ->postJson('/api/auth/register', ['name' => 'A', 'email' => ['a@example.com'], 'password' => 'whatever-it-is'])
            ->assertStatus(422)
            ->assertJsonValidationErrors('email');
    }
}
