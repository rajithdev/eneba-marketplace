<?php

namespace App\Http\Requests\Checkout;

use App\Services\Checkout\PaymentGateway;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Which of the gateway's payment methods the buyer chose. */
class PayOrderRequest extends FormRequest
{
    /** @return array<string, mixed> */
    public function rules(PaymentGateway $gateway): array
    {
        return [
            'payment_method' => ['required', 'string', Rule::in(array_column($gateway->methods(), 'value'))],
        ];
    }
}
