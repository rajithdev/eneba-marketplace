<?php

namespace App\Http\Requests;

use App\Enums\GameType;
use App\Enums\ProductSort;
use App\Support\SearchTerm;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * The query string of GET /api/products.
 *
 *   q                        search text; matches product names, tolerating typos
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

    /** The largest amount the price column (a 32-bit integer) can hold. */
    public const MAX_PRICE_CENTS = 2147483647;

    private const SLUG = '/^[a-z0-9-]+$/';

    /**
     * "steam,xbox-live" becomes ["steam", "xbox-live"] before validation.
     * A filter that is present but empty ("platform=") becomes an empty list,
     * which means "no filter": forms routinely submit their empty fields.
     */
    protected function prepareForValidation(): void
    {
        // A query string that is not valid UTF-8 cannot be compared in the
        // database or quoted back in an error message, so it is refused
        // here, before any rule looks at it.
        if (! mb_check_encoding($this->query(), 'UTF-8')) {
            throw ValidationException::withMessages(['query' => 'The address contains characters that are not valid text.']);
        }

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
            // Free text. Cleaned up by SearchTerm; empty means "no search".
            'q' => ['sometimes', 'nullable', 'string', 'max:'.SearchTerm::MAX_LENGTH],
            'platform' => ['sometimes', 'array', 'max:20'],
            // "bail": only something shaped like a slug is looked up.
            'platform.*' => ['bail', 'string', 'regex:'.self::SLUG, Rule::exists('platforms', 'slug')],
            'region' => ['sometimes', 'array', 'max:20'],
            'region.*' => ['bail', 'string', 'regex:'.self::SLUG, Rule::exists('regions', 'slug')],
            'type' => ['sometimes', 'array', 'max:20'],
            'type.*' => [Rule::enum(GameType::class)],
            'min_price' => ['sometimes', 'nullable', 'integer', 'between:0,'.self::MAX_PRICE_CENTS],
            'max_price' => ['sometimes', 'nullable', 'integer', 'between:0,'.self::MAX_PRICE_CENTS, Rule::when($this->filled('min_price'), 'gte:min_price')],
            'sort' => ['sometimes', 'nullable', Rule::enum(ProductSort::class)],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'between:1,'.self::MAX_PER_PAGE],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'platform.*' => 'Unknown platform ":input".',
            'region.*' => 'Unknown region ":input".',
            'type.*' => 'Unknown product type ":input".',
            'max_price.gte' => 'The maximum price must not be lower than the minimum price.',
        ];
    }

    public function searchTerm(): ?SearchTerm
    {
        return SearchTerm::from($this->validated('q'));
    }

    /**
     * With a search term the default order is best match first; without one
     * there is nothing to be relevant to, so "relevance" means the default.
     */
    public function sort(): ProductSort
    {
        $searching = $this->searchTerm() !== null;
        $chosen = ProductSort::tryFrom((string) $this->validated('sort'));

        if ($chosen === null) {
            return $searching ? ProductSort::Relevance : ProductSort::DEFAULT;
        }

        return $chosen === ProductSort::Relevance && ! $searching ? ProductSort::DEFAULT : $chosen;
    }

    public function perPage(): int
    {
        return (int) ($this->validated('per_page') ?? self::DEFAULT_PER_PAGE);
    }
}
