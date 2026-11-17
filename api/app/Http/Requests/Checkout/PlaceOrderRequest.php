<?php

namespace App\Http\Requests\Checkout;

/**
 * A cart being bought. Unlike a quote, every item must say the price the
 * buyer was shown, so an order is never placed at a price they did not see,
 * and the request must carry an Idempotency-Key header.
 */
class PlaceOrderRequest extends QuoteCartRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            // 16 to 100 letters, digits, "-" or "_": a UUID fits.
            'idempotency_key' => ['required', 'string', 'regex:/^[A-Za-z0-9_-]{16,100}$/'],
        ];
    }

    /** @return array<string, string> */
    public function messages(): array
    {
        return [
            'idempotency_key.required' => 'The Idempotency-Key header is required.',
            'idempotency_key.regex' => 'The Idempotency-Key header must be 16 to 100 letters, digits, hyphens or underscores.',
        ];
    }

    protected function prepareForValidation(): void
    {
        // Validated like a field, but it only ever comes from the header.
        $this->merge(['idempotency_key' => $this->header('Idempotency-Key')]);
    }

    protected function priceRules(): array
    {
        return ['required', 'integer', 'min:1', 'max:2147483647'];
    }
}
