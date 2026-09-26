#!/usr/bin/env bash
# PageX Docker Compose helper.
# Runs the blob-server (Caddy) + Vector pipeline only. The console is hosted on
# Vercel; Postgres is Neon and Redis is Upstash, so there is no db/redis here.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$ROOT/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Copy .env.example to .env and fill in the required values first." >&2
  exit 1
fi

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "Missing compose file: $COMPOSE_FILE" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

usage() {
  cat <<'EOF'
Usage: scripts/docker.sh <command> [args...]

Commands:
  up [services...]       Start core stack in detached mode (default: all core)
  down [args...]         Stop and remove containers
  build [services...]    Build images
  rebuild [services...]  Build images with --no-cache, then up -d
  restart [services...]  Restart running services
  ps                     List containers
  logs [services...]     Follow logs (default: all)
  exec <service> [cmd]   Exec into a service (default cmd: sh)
  pull [services...]     Pull images
  config                 Validate and print compose config
  help                   Show this help

Environment overrides:
  ENV_FILE       Path to env file (default: ./.env)
  COMPOSE_FILE   Path to compose file (default: ./docker-compose.yml)

Examples:
  scripts/docker.sh up
  scripts/docker.sh up blob-server
  scripts/docker.sh logs blob-server
  scripts/docker.sh rebuild blob-server
EOF
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  up)
    if [[ $# -eq 0 ]]; then
      compose up -d
    else
      compose up -d "$@"
    fi
    ;;
  down)
    compose down "$@"
    ;;
  build)
    compose build "$@"
    ;;
  rebuild)
    if [[ $# -eq 0 ]]; then
      compose build --no-cache
      compose up -d
    else
      compose build --no-cache "$@"
      compose up -d "$@"
    fi
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
  exec)
    service="${1:-}"
    if [[ -z "$service" ]]; then
      echo "Usage: scripts/docker.sh exec <service> [command...]" >&2
      exit 1
    fi
    shift
    if [[ $# -eq 0 ]]; then
      compose exec "$service" sh
    else
      compose exec "$service" "$@"
    fi
    ;;

  pull)
    compose pull "$@"
    ;;
  config)
    compose config "$@"
    ;;
  help|-h|--help)
    usage
    ;;
  *)
    # Pass through any other docker compose subcommand
    compose "$cmd" "$@"
    ;;
esac
