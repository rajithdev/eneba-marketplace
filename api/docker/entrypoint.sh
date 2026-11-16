#!/bin/sh
# Starts the production container. Runs every time the service starts,
# including each time the free instance wakes from sleep.
set -e

# 1. Listen on the port the host assigned.
PORT="${PORT:-10000}"
sed -i "s/^Listen .*/Listen ${PORT}/" /etc/apache2/ports.conf
sed -i "s/<VirtualHost \*:[0-9]*>/<VirtualHost *:${PORT}>/" /etc/apache2/sites-available/000-default.conf

# 2. Refuse to start with unsafe or missing settings, with a clear message
#    in the deploy log instead of a broken site.
if [ "${APP_ENV}" = "production" ]; then
    [ -n "${APP_KEY}" ] || { echo "APP_KEY is not set"; exit 1; }
    [ "${APP_DEBUG}" != "true" ] || { echo "APP_DEBUG must not be true in production"; exit 1; }

    # FRONTEND_URL decides which origin may use the login session; APP_URL is
    # the root of every generated link. Both must be a bare https origin
    # ("https://shop.example.com"): no path, no trailing slash. A typo here
    # otherwise shows up later as "login silently does not work".
    for name in FRONTEND_URL APP_URL; do
        eval "value=\${$name}"
        case "$value" in
            https://*/*|http://localhost*/*) echo "$name must be an origin without a path or trailing slash: $value"; exit 1 ;;
            https://*|http://localhost*) ;;
            *) echo "$name must be set to an https:// origin (got: '$value')"; exit 1 ;;
        esac
    done

    [ "${SESSION_SECURE_COOKIE}" = "true" ] || { echo "SESSION_SECURE_COOKIE must be true in production"; exit 1; }
    # A cookie domain would have to name a host; ours must stay bound to
    # whatever host the visitor used (the frontend's), so it must be unset.
    [ -z "${SESSION_DOMAIN}" ] || [ "${SESSION_DOMAIN}" = "null" ] || { echo "SESSION_DOMAIN must not be set"; exit 1; }
fi

# 3. Read the environment once and cache it, so requests do not re-read it.
php artisan config:cache
php artisan route:cache

# 4. Apply database migrations. The free plan has no separate "before
#    deploy" step, so this is the documented place for it. If the database
#    is unreachable the container stops here and the deploy fails visibly.
php artisan migrate --force

# The commands above ran as root; the web server runs as www-data.
chown -R www-data:www-data storage bootstrap/cache

exec apache2-foreground
