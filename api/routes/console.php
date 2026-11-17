<?php

use App\Services\Checkout\SettleOrder;
use Illuminate\Support\Facades\Artisan;

// Puts the keys of unpaid, overdue orders back on sale. Requests do this
// themselves (ReleaseExpiredReservations), so nothing depends on it; it is
// here for a host that can run a command every minute.
Artisan::command('orders:expire', function (SettleOrder $settle) {
    $this->info($settle->expireOverdue(limit: 500).' overdue orders settled.');
})->purpose('Settle unpaid orders whose reservation has run out');
