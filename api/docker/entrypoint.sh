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
