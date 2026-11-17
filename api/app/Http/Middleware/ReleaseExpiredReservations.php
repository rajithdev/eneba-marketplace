<?php

namespace App\Http\Middleware;

use App\Services\Checkout\SettleOrder;
use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

/**
 * Before a request that reads or takes stock, put keys held by unpaid,
 * overdue orders back on sale.
 *
 * A background job would normally do this every minute. The free hosting
 * tier has none, so the visitors' own requests trigger it. When nothing is
 * overdue, which is nearly always, it costs one small indexed query.
 */
class ReleaseExpiredReservations
{
    public function __construct(private SettleOrder $settle) {}

    public function handle(Request $request, Closure $next): Response
    {
        $this->settle->expireOverdue();

        return $next($request);
    }
}
