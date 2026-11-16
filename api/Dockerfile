# Development image for the Laravel API.
# A production stage (no dev dependencies, cached config) is added with the
# deployment work; this one is only what local development and tests need.
FROM php:8.4-cli

# pdo_pgsql: PostgreSQL driver. zip/unzip/git: Composer needs them to install
# packages. pcntl: lets tests fork processes to exercise concurrent checkouts.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev libzip-dev unzip git \
    && docker-php-ext-install pdo_pgsql zip pcntl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

EXPOSE 8000

CMD ["php", "artisan", "serve", "--host=0.0.0.0", "--port=8000"]
