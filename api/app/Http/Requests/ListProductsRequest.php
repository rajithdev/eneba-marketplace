<?php

namespace App\Http\Requests;

use App\Enums\GameType;
use App\Enums\ProductSort;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * The query string of GET /api/products.
 *
 *   platform, region, type   one or more values separated by commas,
 *                            e.g. platform=steam,xbox-live
 *   min_price, max_price     whole cents, compared with the product's
 *                            cheapest in-stock price
 *   sort                     see App\Enums\ProductSort
 *   page, per_page
 *
 * Anything unknown or malformed is rejected with 422 and a message per
 * field, rather than being silently ignored: a mistyped filter should not
 * quietly show the whole catalog.
 */
class ListProductsRequest extends FormRequest
{
    public const DEFAULT_PER_PAGE = 24;

    public const MAX_PER_PAGE = 48;

    /**
     * "steam,xbox-live" becomes ["steam", "xbox-live"] before validation.
     * A filter that is present but empty ("platform=") becomes an empty list,
     * which means "no filter": forms routinely submit their empty fields.
     */
    protected function prepareForValidation(): void
    {
        foreach (['platform', 'region', 'type'] as $filter) {
            if ($this->has($filter) && ! is_array($this->input($filter))) {
                $this->merge([
                    $filter => array_values(array_filter(explode(',', (string) $this->input($filter)), 'strlen')),
                ]);
            }
        }
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'platform' => ['sometimes', 'array', 'max:20'],
            'platform.*' => ['string', Rule::exists('platforms', 'slug')],
            'region' => ['sometimes', 'array', 'max:20'],
            'region.*' => ['string', Rule::exists('regions', 'slug')],
            'type' => ['sometimes', 'array'],
            'type.*' => [Rule::enum(GameType::class)],
            'min_price' => ['sometimes', 'nullable', 'integer', 'min:0'],
            'max_price' => ['sometimes', 'nullable', 'integer', 'min:0', Rule::when($this->filled('min_price'), 'gte:min_price')],
            'sort' => ['sometimes', 'nullable', Rule::enum(ProductSort::class)],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'between:1,'.self::MAX_PER_PAGE],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'platform.*.exists' => 'Unknown platform ":input".',
            'region.*.exists' => 'Unknown region ":input".',
            'type.*' => 'Unknown product type ":input".',
            'max_price.gte' => 'The maximum price must not be lower than the minimum price.',
        ];
    }

    public function sort(): ProductSort
    {
        return ProductSort::tryFrom((string) $this->validated('sort')) ?? ProductSort::DEFAULT;
    }

    public function perPage(): int
    {
        return (int) ($this->validated('per_page') ?? self::DEFAULT_PER_PAGE);
    }
}
