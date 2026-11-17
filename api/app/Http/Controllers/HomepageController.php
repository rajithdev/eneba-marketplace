<?php

namespace App\Http\Controllers;

use App\Services\Homepage\BuildHomepage;
use Illuminate\Http\JsonResponse;

/**
 * GET /api/homepage: the blocks of the homepage, in the order to draw them.
 * See BuildHomepage for where each one comes from.
 */
class HomepageController extends Controller
{
    public function __invoke(BuildHomepage $homepage): JsonResponse
    {
        return response()->json(['data' => ['blocks' => $homepage->handle()]]);
    }
}
