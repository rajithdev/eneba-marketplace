<?php

return [
    // How long a buyer has to pay before the keys go back on sale.
    'reservation_minutes' => (int) env('CHECKOUT_RESERVATION_MINUTES', 10),

    // Limits on one cart, so a single request cannot hold the whole stock.
    'max_lines' => 20,
    'max_quantity' => 10,
];
