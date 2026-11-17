<?php

namespace App\Services\Checkout;

use RuntimeException;

/** Fewer keys could be reserved than the order line asks for. */
class OutOfStock extends RuntimeException {}
