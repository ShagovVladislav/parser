#!/usr/bin/env sh
set -e

if [ ! -f .env ]; then
    cp .env.example .env
fi

set_env_var() {
    key="$1"
    value="$(printenv "$key" || true)"

    if [ -z "$value" ]; then
        return
    fi

    escaped_value="$(printf '%s' "$value" | sed 's/[\/&]/\\&/g')"

    if grep -q "^${key}=" .env; then
        sed -i "s/^${key}=.*/${key}=${escaped_value}/" .env
    else
        printf '\n%s=%s\n' "$key" "$value" >> .env
    fi
}

for key in \
    APP_ENV \
    APP_DEBUG \
    APP_KEY \
    APP_URL \
    FRONTEND_URL \
    FRONTEND_URLS \
    SANCTUM_STATEFUL_DOMAINS \
    SESSION_DOMAIN \
    SESSION_DRIVER \
    DB_CONNECTION \
    DB_HOST \
    DB_PORT \
    DB_DATABASE \
    DB_USERNAME \
    DB_PASSWORD \
    QUEUE_CONNECTION \
    CACHE_STORE \
    YANDEX_PARSER_NODE_BINARY \
    YANDEX_PARSER_SCRIPT_PATH \
    YANDEX_PARSER_MAX_REVIEWS \
    YANDEX_PARSER_TIMEOUT \
    YANDEX_PARSER_DEBUG \
    YANDEX_PARSER_DEBUG_DIR \
    PLAYWRIGHT_BROWSERS_PATH
do
    set_env_var "$key"
done

mkdir -p storage/framework/cache storage/framework/sessions storage/framework/views bootstrap/cache
chmod -R ug+rw storage bootstrap/cache

if [ ! -f vendor/autoload.php ]; then
    composer install --no-interaction --prefer-dist
fi

if [ ! -d node_modules/playwright ]; then
    npm ci
fi

if ! grep -q '^APP_KEY=base64:' .env && [ -z "$APP_KEY" ]; then
    php artisan key:generate --force
fi

php artisan config:clear

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
    echo "Waiting for PostgreSQL..."

    until php -r '
        $host = getenv("DB_HOST") ?: "postgres";
        $port = getenv("DB_PORT") ?: "5432";
        $db = getenv("DB_DATABASE") ?: "parser";
        $user = getenv("DB_USERNAME") ?: "parser";
        $password = getenv("DB_PASSWORD") ?: "parser";

        try {
            new PDO("pgsql:host={$host};port={$port};dbname={$db}", $user, $password);
        } catch (Throwable $exception) {
            exit(1);
        }
    '; do
        sleep 2
    done

    php artisan migrate --seed --force
fi

exec "$@"
