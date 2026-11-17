<?php

namespace App\Http\Resources;

use App\Enums\LicenseKeyStatus;
use App\Enums\OrderStatus;
use App\Models\LicenseKey;
use App\Models\OrderItem;
use App\Services\Checkout\PaymentGateway;
use Illuminate\Http\Request;

/**
 * One order in full, for its buyer. Adds two things to the summary:
 *
 *   - the license keys, and only once the order is paid. Until then the
 *     list is empty: a held key is not the buyer's yet.
 *   - while the order awaits payment, the ways to pay for it.
 */
class OrderResource extends OrderSummaryResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            ...parent::toArray($request),
            'payment_methods' => $this->status === OrderStatus::Pending ? app(PaymentGateway::class)->methods() : [],
        ];
    }

    /** @return array<string, mixed> */
    protected function item(OrderItem $item): array
    {
        $keys = $this->status === OrderStatus::Paid
            ? $item->licenseKeys->where('status', LicenseKeyStatus::Sold)->sortBy('id')
            : collect();

        return [
            ...parent::item($item),
            'keys' => $keys->map(fn (LicenseKey $key) => $key->code)->values()->all(),
        ];
    }
}
