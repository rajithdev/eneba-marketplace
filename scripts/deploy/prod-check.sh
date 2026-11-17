#!/bin/sh
# Builds and runs the production stack locally, then verifies it end to end.
#
#   make prod-check
#
# Steps: build the frontend exactly as the host will; build the production
# API image; start it with production settings against a separate local
# database; put a stand-in for the frontend host's proxy in front of it; run
# scripts/deploy/verify-deployment.mjs against that; clean up.
set -e
cd "$(dirname "$0")/../.."

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prodcheck.yml"
# Local ports for this check. Change them here if something else uses them.
FRONTEND_PORT=4780
API_PORT=8100
FRONTEND_URL="http://localhost:${FRONTEND_PORT}"
export PRODCHECK_API_PORT="${API_PORT}"
ENV_FILE=.env.prodcheck

cleanup() {
    [ -n "$PROXY_PID" ] && kill "$PROXY_PID" 2>/dev/null || true
    $COMPOSE rm -sf api-prod >/dev/null 2>&1 || true
    rm -f "$ENV_FILE"
}
trap cleanup EXIT

echo "== Building the frontend (npm ci && npm run build)"
(cd web && npm ci --silent && npm run build --silent)

echo "== Building the production API image"
docker compose up -d db >/dev/null
# The container's environment: everything render.yaml sets, exactly as written
# there, followed by local stand-ins. Later lines win.
{
    node scripts/deploy/render-env.mjs 2>/dev/null
    echo "# --- stand-ins for the five values typed into Render's dashboard"
    # A throwaway application key for this run only. Never printed.
    echo "APP_KEY=$(docker compose run --rm -T api php artisan key:generate --show)"
    echo "FRONTEND_URL=${FRONTEND_URL}"
    echo "APP_URL=${FRONTEND_URL}"
    echo "DB_HOST=db"
    echo "DB_PASSWORD=eneba"
    echo "# --- the local database is not Neon: its own names, and no TLS"
    echo "DB_DATABASE=eneba_prodcheck"
    echo "DB_USERNAME=eneba"
    echo "DB_SSLMODE=disable"
    echo "DB_SSLROOTCERT="
    echo "# --- on for this local run only, so the checks can see the server's view"
    echo "DEPLOY_DIAGNOSTICS=true"
} > "$ENV_FILE"
$COMPOSE build -q api-prod

echo "== Starting it with production settings on a separate database"
docker compose exec -T db psql -U eneba -d postgres -q -c "DROP DATABASE IF EXISTS eneba_prodcheck" -c "CREATE DATABASE eneba_prodcheck OWNER eneba"
$COMPOSE up -d api-prod >/dev/null

printf "   waiting for the API"
for attempt in $(seq 1 60); do
    if curl -fsS "http://localhost:${API_PORT}/api/health" >/dev/null 2>&1; then echo " ready"; break; fi
    printf "."; sleep 1
    if [ "$attempt" = 60 ]; then echo " did not start"; $COMPOSE logs --tail 40 api-prod; exit 1; fi
done

echo "== Starting the frontend host stand-in"
API_ORIGIN="http://localhost:${API_PORT}" PORT="${FRONTEND_PORT}" node scripts/deploy/local-frontend-host.mjs &
PROXY_PID=$!
sleep 1
# Stop here if it could not start (for example the port is taken); otherwise
# the checks below would run against whatever else is listening there.
kill -0 "$PROXY_PID" 2>/dev/null || { echo "The stand-in did not start."; exit 1; }

echo "== Verifying"
node scripts/deploy/verify-deployment.mjs "${FRONTEND_URL}" --behind-https-proxy --api-origin="http://localhost:${API_PORT}" --purchase
