# One Dockerfile, three stages.
#   base  PHP 8.4 + Apache + the PHP extensions the app needs
#   dev   what docker-compose.yml runs locally (code is mounted, not copied)
#   prod  what the hosting provider builds and runs
#
# "prod" must stay the LAST stage: the host builds the Dockerfile without
# choosing a stage, and Docker then builds the last one.

# ---------------------------------------------------------------- base ---
FROM php:8.4-apache AS base

# pdo_pgsql: PostgreSQL driver.  zip/unzip/git: needed by Composer.
# pcntl: lets tests fork processes.  opcache: caches compiled PHP in memory.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev libzip-dev unzip git \
    && docker-php-ext-install pdo_pgsql zip pcntl opcache \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# ----------------------------------------------------------------- dev ---
FROM base AS dev

EXPOSE 8000
CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]

# ---------------------------------------------------------------- prod ---
FROM base AS prod

# PHP's recommended production settings (errors are logged, never displayed).
RUN mv "$PHP_INI_DIR/php.ini-production" "$PHP_INI_DIR/php.ini"
COPY docker/apache.conf /etc/apache2/sites-available/000-default.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

# Install dependencies before copying the code, so this slow layer is reused
# whenever only application code changed. No dev packages in production.
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-scripts --no-autoloader --prefer-dist --no-interaction

COPY . .
RUN mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs bootstrap/cache \
    && composer dump-autoload --optimize --no-dev \
    && chown -R www-data:www-data storage bootstrap/cache \
    && chmod +x /usr/local/bin/entrypoint.sh

# The host tells the container which port to listen on through $PORT
# (10000 by default on Render); the entrypoint applies it.
EXPOSE 10000
CMD ["entrypoint.sh"]
