<?php

namespace App\Support;

use Illuminate\Http\Request;

/**
 * The two addresses a request can be rate limited by.
 *
 * In production a request reaches the API either through our frontend host
 * (visitor -> frontend proxy -> API host's edge -> container) or directly
 * (caller -> API host's edge -> container). Neither address alone is enough:
 *
 *                      through the frontend        called directly
 *   claimed()          the real visitor            whatever the caller typed
 *   edge()             the frontend's server       the real caller
 *
 * Limiting by both closes the gap: a direct caller cannot escape the edge
 * limit by inventing addresses, and visitors behind the frontend are still
 * limited individually.
 */
class ClientAddress
{
    /**
     * First address in X-Forwarded-For. Our frontend host overwrites this
     * header with the visitor's address, so it is accurate for requests that
     * came through it, and forgeable for requests that did not.
     */
    public static function claimed(Request $request): string
    {
        $first = trim(explode(',', (string) $request->headers->get('X-Forwarded-For'))[0]);

        return $first !== '' ? $first : static::edge($request);
    }

    /**
     * Address that connected to the API host's edge network. The edge writes
     * CF-Connecting-IP itself on every request, replacing anything the caller
     * sent. Without that header (local development) it is the socket's peer.
     */
    public static function edge(Request $request): string
    {
        return $request->headers->get('CF-Connecting-IP') ?: (string) $request->server('REMOTE_ADDR');
    }
}
