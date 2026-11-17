<?php

namespace App\Http\Requests\Checkout;

use Illuminate\Foundation\Http\FormRequest;

/**
 * A cart as the browser holds it: which offers and how many, and optionally
 * the price the buyer was last shown for each.
 */
class QuoteCartRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'items' => ['required', 'array', 'list', 'min:1', 'max:'.config('checkout.max_lines')],
            'items.*' => ['required', 'array:offer_id,quantity,unit_price_cents'],
            // The upper bound is the largest id the database column can hold.
            'items.*.offer_id' => ['required', 'integer', 'min:1', 'max:9223372036854775807'],
            // More than one order may hold is not an error here: the quote
            // answers with the quantity that can be bought and says why.
            'items.*.quantity' => ['required', 'integer', 'min:1', 'max:1000'],
            'items.*.unit_price_cents' => $this->priceRules(),
        ];
    }

    /**
     * Optional here: the cart page may ask before it has ever seen a price.
     *
     * @return list<string>
     */
    protected function priceRules(): array
    {
        return ['sometimes', 'nullable', 'integer', 'min:1', 'max:2147483647'];
    }
}
