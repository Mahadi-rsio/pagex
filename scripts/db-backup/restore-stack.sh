#!/usr/bin/env bash
# Stop app writers, restore latest MinIO DB dump into Postgres, start writers again.
#
# Usage (from repo root):
#   ./scripts/db-backup/restore-stack.sh
#   CONFIRM=yes ./scripts/db-backup/restore-stack.sh   # skip interactive prompt
#
# Env overrides:
#   COMPOSE_FILE  default: <repo>/docker-compose.yml
#   ENV_FILE      default: <repo>/.env
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

# Services that write to / depend on a consistent Postgres schema
STOP_SERVICES=(api console db-backup)
# db stays up (restore target). blob-server left running (blobs unchanged).

compose() {
  if [[ -f "$ENV_FILE" ]]; then
    docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
  else
    docker compose -f "$COMPOSE_FILE" "$@"
  fi
}

if [[ "${CONFIRM:-}" != "yes" ]]; then
  echo "[restore-stack] This will DROP and reload the pagex database from the latest MinIO backup."
  echo "[restore-stack] Services to stop: ${STOP_SERVICES[*]}"
  read -r -p "[restore-stack] Type 'yes' to continue: " answer
  if [[ "$answer" != "yes" ]]; then
    echo "[restore-stack] Aborted."
    exit 1
  fi
fi

echo "[restore-stack] Ensuring db and db-backup images/containers are available..."
compose up -d db db-backup

echo "[restore-stack] Stopping ${STOP_SERVICES[*]}..."
compose stop "${STOP_SERVICES[@]}"

# db-backup must be running to exec restore.sh (mc + pg client)
echo "[restore-stack] Starting db-backup for restore..."
compose start db-backup
# brief wait for entrypoint mc alias / pg_isready
sleep 2

echo "[restore-stack] Running restore (latest dump)..."
compose exec -T -e CONFIRM=yes db-backup /scripts/restore.sh

echo "[restore-stack] Starting ${STOP_SERVICES[*]}..."
compose start "${STOP_SERVICES[@]}"

echo "[restore-stack] Done."
compose ps api console db db-backup
