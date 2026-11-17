<?php

namespace App\Http\Controllers;

use App\Enums\OrderStatus;
use App\Http\Requests\Checkout\PayOrderRequest;
use App\Http\Requests\Checkout\PlaceOrderRequest;
use App\Http\Resources\OrderResource;
use App\Http\Resources\OrderSummaryResource;
use App\Models\Order;
use App\Services\Checkout\CartChanged;
use App\Services\Checkout\CheckoutInProgress;
use App\Services\Checkout\IdempotencyKeyReused;
use App\Services\Checkout\PlaceOrder;
use App\Services\Checkout\SettleOrder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * A buyer's orders: placing one, paying for it, and reading it back.
 *
 * Every route here requires a signed-in user, and every order is looked up
 * through that user's own orders, so someone else's order id answers
 * "not found" exactly like an id that does not exist.
 */
class OrderController extends Controller
{
    private const WITH = ['payment', 'items.product.game', 'items.product.platform', 'items.product.region'];

    public function index(Request $request, SettleOrder $settle): JsonResponse
    {
        // A buyer returning to their orders sees them up to date: an unpaid
        // order whose payment did go through is completed first. There is
        // at most one such order per buyer in normal use.
        $request->user()->orders()->where('status', OrderStatus::Pending)->get()
            ->each(fn (Order $order) => $settle->reconcile($order));

        $page = $request->user()->orders()->with(self::WITH)->latest('id')->paginate(10);

        return response()->json([
            'data' => OrderSummaryResource::collection($page->items())->resolve($request),
            'meta' => [
                'current_page' => $page->currentPage(),
                'per_page' => $page->perPage(),
                'total' => $page->total(),
                'last_page' => $page->lastPage(),
            ],
        ]);
    }

    /**
     * Step 1: hold the keys and create a pending order.
     *
     * 201 a new order; 200 the order an identical earlier request created;
     * 409 the cart changed (with the new quote, nothing held), or the
     * buyer's own simultaneous checkouts collided (nothing held; try again).
     */
    public function store(PlaceOrderRequest $request, PlaceOrder $placeOrder): JsonResponse
    {
        try {
            $order = $placeOrder->handle($request->user(), $request->validated('items'), $request->validated('idempotency_key'));
        } catch (CartChanged $changed) {
            return response()->json([
                'message' => 'Your cart has changed. Review the updated prices and availability.',
                'code' => 'cart_changed',
                'quote' => $changed->quote,
            ], 409);
        } catch (CheckoutInProgress $inProgress) {
            return response()->json(['message' => $inProgress->getMessage(), 'code' => 'checkout_in_progress'], 409);
        } catch (IdempotencyKeyReused $reused) {
            return response()->json(['message' => $reused->getMessage(), 'code' => 'idempotency_key_reused'], 422);
        }

        return $this->respond($request, $order, $order->wasRecentlyCreated ? 201 : 200);
    }

    public function show(Request $request, string $order, SettleOrder $settle): JsonResponse
    {
        // Reading a pending order also brings it up to date: a payment that
        // went through but was never recorded is recorded now, and an
        // overdue order is expired.
        return $this->respond($request, $settle->reconcile($this->find($request, $order)));
    }

    /**
     * Steps 2 and 3: charge, then deliver the keys or put them back.
     *
     * 200 paid; 402 the payment was declined; 409 the order can no longer be
     * paid for (expired or cancelled). The order is in the body every time,
     * and repeating the request gives the same answer without a second charge.
     */
    public function pay(PayOrderRequest $request, string $order, SettleOrder $settle): JsonResponse
    {
        $order = $settle->pay($this->find($request, $order), $request->validated('payment_method'));

        return match ($order->status) {
            OrderStatus::Paid => $this->respond($request, $order),
            OrderStatus::Failed => $this->respond($request, $order, 402, 'The payment was declined. You have not been charged.'),
            default => $this->respond($request, $order, 409, 'This order can no longer be paid for. You have not been charged.'),
        };
    }

    /** Give up a pending order so its keys go back on sale straight away. */
    public function cancel(Request $request, string $order, SettleOrder $settle): JsonResponse
    {
        return $this->respond($request, $settle->cancel($this->find($request, $order)));
    }

    private function find(Request $request, string $publicId): Order
    {
        return $request->user()->orders()->where('public_id', $publicId)->first()
            ?? abort(404, 'Order not found.');
    }

    private function respond(Request $request, Order $order, int $status = 200, ?string $message = null): JsonResponse
    {
        $order->load([...self::WITH, 'items.licenseKeys']);

        return response()->json([
            ...($message === null ? [] : ['message' => $message]),
            'data' => OrderResource::make($order)->resolve($request),
        ], $status);
    }
}
