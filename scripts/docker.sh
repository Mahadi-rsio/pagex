#!/usr/bin/env bash
# PageX Docker Compose helper
# Always loads infrastructure/configs/.env (Docker network hostnames).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT/infrastructure/docker/compose/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-$ROOT/infrastructure/configs/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE" >&2
  echo "Copy the example or create infrastructure/configs/.env first." >&2
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
  up [services...]       Start services in detached mode (default: all)
  down [args...]         Stop and remove containers
  build [services...]    Build images
  rebuild [services...]  Build images with --no-cache, then up -d
  restart [services...]  Restart running services
  ps                     List containers
  logs [services...]     Follow logs (default: all)
  exec <service> [cmd]   Exec into a service (default cmd: sh)
  migrate                Run API + console migrators
  console                Start console stack deps + console
  api                    Start API stack deps + api
  pull [services...]     Pull images
  config                 Validate and print compose config
  help                   Show this help

Environment overrides:
  ENV_FILE       Path to env file (default: infrastructure/configs/.env)
  COMPOSE_FILE   Path to compose file

Examples:
  scripts/docker.sh up
  scripts/docker.sh up api console db redis
  scripts/docker.sh logs console
  scripts/docker.sh rebuild console console-migrator
  scripts/docker.sh migrate
EOF
}

cmd="${1:-help}"
shift || true

case "$cmd" in
  up)
    compose up -d "$@"
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
    compose ps "$@"
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
  migrate)
    compose up -d db
    compose run --rm migrator
    compose run --rm console-migrator
    ;;
  console)
    compose up -d db redis migrator console-migrator console
    ;;
  api)
    compose up -d db redis pgbouncer migrator api
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
