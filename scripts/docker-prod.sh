#!/usr/bin/env bash
# PageX production Docker Compose helper.
# Pulls pre-built GHCR images — never builds locally.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Copy .env.example to .env and fill in required values first." >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

usage() {
  cat <<'EOF'
Usage: scripts/docker-prod.sh <command> [args...]
Production stack: pulls images from GHCR, no local builds.

Commands:
  up [services...]       Pull images then start detached (default: all)
  pull [services...]     Pull images only
  down [args...]         Stop and remove containers
  restart [services...]  Restart running services
  ps [args...]           List containers
  logs [services...]     Follow logs (default: all)
  config                 Validate and print compose config
  help                   Show this help

Environment overrides:
  PAGEX_VERSION   Image tag to deploy (default: 1.4.0)
  PAGEX_REGISTRY  Image registry/namespace (default: ghcr.io/mahadi-rsio/pagex)
  ENV_FILE        Path to env file (default: ./.env)
  COMPOSE_FILE    Path to compose file (default: ./docker-compose.prod.yml)

Examples:
  scripts/docker-prod.sh up
  PAGEX_VERSION=1.5.0 scripts/docker-prod.sh up
  scripts/docker-prod.sh logs console
EOF
}

cmd="${1:-up}"
shift || true

case "$cmd" in
  up)
    compose pull "$@"
    compose up -d "$@"
    ;;
  pull)
    compose pull "$@"
    ;;
  down)
    compose down "$@"
    ;;
  restart)
    compose restart "$@"
    ;;
  ps)
    compose ps -a "$@"
    ;;
  logs)
    compose logs -f "$@"
    ;;
  config)
    compose config "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    usage >&2
    exit 1
    ;;
esac
