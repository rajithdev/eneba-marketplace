<?php

namespace App\Http\Controllers;

use App\Http\Requests\Auth\LoginRequest;
use App\Http\Requests\Auth\RegisterRequest;
use App\Http\Resources\UserResource;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Sign-up, sign-in and sign-out for the React app.
 *
 * Authentication is a server-side session identified by an HttpOnly cookie
 * (Sanctum's first-party SPA mode). No token is ever handed to JavaScript.
 */
class AuthController extends Controller
{
    public function register(RegisterRequest $request): JsonResponse
    {
        $this->ensureCalledFromTheWebApp($request);

        $user = User::create($request->validated());

        Auth::guard('web')->login($user);
        // New session id after a change of identity, so an id planted
        // before sign-in cannot be reused afterwards (session fixation).
        $request->session()->regenerate();

        return UserResource::make($user)->response()->setStatusCode(201);
    }

    public function login(LoginRequest $request): UserResource
    {
        $this->ensureCalledFromTheWebApp($request);

        if (! Auth::guard('web')->attempt($request->validated())) {
            // Same message whether the email or the password is wrong, so
            // the form cannot be used to find out which emails are registered.
            throw ValidationException::withMessages([
                'email' => ['These credentials do not match our records.'],
            ]);
        }

        $request->session()->regenerate();

        return UserResource::make($request->user());
    }

    public function me(Request $request): UserResource
    {
        return UserResource::make($request->user());
    }

    public function logout(Request $request): Response
    {
        $this->ensureCalledFromTheWebApp($request);

        Auth::guard('web')->logout();
        // Destroy the server-side session, not just the browser's cookie.
        $request->session()->invalidate();
        $request->session()->regenerateToken();

        return response()->noContent();
    }

    /**
     * Sessions only exist for requests that come from our own frontend
     * (Sanctum decides this from the Origin/Referer header). Anything else
     * gets a clear error instead of a crash on the missing session.
     */
    private function ensureCalledFromTheWebApp(Request $request): void
    {
        abort_unless($request->hasSession(), 400, 'This endpoint can only be used from the web app.');
    }
}
