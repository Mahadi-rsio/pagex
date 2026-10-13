#!/usr/bin/env bash
#
# PageX logs service — one-time infrastructure setup.
#
# Creates the R2 bucket, Cloudflare Queue (+ R2 event notification + HTTP pull
# consumer), applies the Neon migration, registers the Logpush job, deploys the
# Fly worker, and deploys the cron worker.
#
# Idempotent: safe to re-run.
#
# Required environment (or service/logs/.env):
#   CF_API_TOKEN               Logs Write (+ R2 edit, Queues edit)
#   CF_ACCOUNT_ID              Cloudflare account id
#   CF_ZONE_ID                 Zone id whose http_requests logs are pushed
#   R2_ACCESS_KEY_ID           R2 S3 API token key id
#   R2_SECRET_ACCESS_KEY       R2 S3 API token secret
#   LOGS_DATABASE_URL_DIRECT   Neon *direct* (non-pooled) connection string
#   LOGS_DATABASE_URL          Neon *pooled* connection string (worker runtime)
#   CF_QUEUE_API_TOKEN         Queues read+write token used by the worker
#
# Optional:
#   R2_ACCOUNT_ID (default: CF_ACCOUNT_ID)   R2_LOGS_BUCKET (default logs-raw)
#   R2_PREFIX (default raw/)                 CF_QUEUE_NAME (default pagex-logs)
#   FLY_APP (default pagex-logs)             FLY_ORG

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="https://api.cloudflare.com/client/v4"

log()  { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

# Load service/logs/.env without sourcing it: `source` breaks on values
# containing `&` or spaces (e.g. Neon URLs with ?sslmode=require&channel_binding=...).
if [[ -f "$ROOT/.env" ]]; then
	while IFS='=' read -r name value; do
		[[ "$name" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && export "$name=$value"
	done < "$ROOT/.env"
fi

R2_ACCOUNT_ID="${R2_ACCOUNT_ID:-${CF_ACCOUNT_ID:-}}"
R2_LOGS_BUCKET="${R2_LOGS_BUCKET:-logs-raw}"
R2_PREFIX="${R2_PREFIX:-raw/}"
CF_QUEUE_NAME="${CF_QUEUE_NAME:-pagex-logs}"
FLY_APP="${FLY_APP:-pagex-logs}"

for v in CF_API_TOKEN CF_ACCOUNT_ID CF_ZONE_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY \
	LOGS_DATABASE_URL_DIRECT LOGS_DATABASE_URL CF_QUEUE_API_TOKEN; do
	[[ -n "${!v:-}" ]] || die "missing required variable: $v"
done
[[ -n "$R2_ACCOUNT_ID" ]] || die "missing R2_ACCOUNT_ID (or CF_ACCOUNT_ID)"

command -v jq >/dev/null || die "jq is required"
command -v curl >/dev/null || die "curl is required"

cf_api() {
	local method=$1 path=$2 data=${3:-}
	local args=(-sS -X "$method" "${API}${path}"
		-H "Authorization: Bearer ${CF_API_TOKEN}"
		-H "Content-Type: application/json")
	[[ -n "$data" ]] && args+=(--data "$data")
	curl "${args[@]}"
}

# ---------------------------------------------------------------- R2 bucket --
log "R2 bucket: ${R2_LOGS_BUCKET}"
buckets="$(cf_api GET "/accounts/${CF_ACCOUNT_ID}/r2/buckets")"
if jq -e --arg b "$R2_LOGS_BUCKET" '.result.buckets[]? | select(.name == $b)' >/dev/null <<<"$buckets"; then
	log "  already exists"
else
	resp="$(cf_api POST "/accounts/${CF_ACCOUNT_ID}/r2/buckets" "$(jq -cn --arg n "$R2_LOGS_BUCKET" '{name:$n}')")"
	jq -e '.success' >/dev/null <<<"$resp" || die "create bucket failed: $resp"
	log "  created"
fi

# ------------------------------------------------------------- queue setup --
log "Queue: ${CF_QUEUE_NAME}"
queues="$(cf_api GET "/accounts/${CF_ACCOUNT_ID}/queues")"
QUEUE_ID="$(jq -r --arg q "$CF_QUEUE_NAME" '.result[]? | select(.queue_name == $q) | .queue_id' <<<"$queues" | head -n1)"
if [[ -z "$QUEUE_ID" || "$QUEUE_ID" == "null" ]]; then
	resp="$(cf_api POST "/accounts/${CF_ACCOUNT_ID}/queues" "$(jq -cn --arg n "$CF_QUEUE_NAME" '{queue_name:$n}')")"
	QUEUE_ID="$(jq -r '.result.queue_id // empty' <<<"$resp")"
	[[ -n "$QUEUE_ID" ]] || die "create queue failed: $resp"
	log "  created (${QUEUE_ID})"
else
	log "  already exists (${QUEUE_ID})"
fi

log "R2 event notification (PutObject ${R2_PREFIX}* -> queue)"
resp="$(cf_api PUT "/accounts/${CF_ACCOUNT_ID}/r2/buckets/${R2_LOGS_BUCKET}/event_notifications" \
	"$(jq -cn --arg q "$QUEUE_ID" --arg p "$R2_PREFIX" '{rules:[{actions:["PutObject"],prefix:$p,queue:$q}]}')")"
jq -e '.success' >/dev/null <<<"$resp" || die "event notification failed: $resp"
log "  configured"

log "HTTP pull consumer on queue"
resp="$(cf_api POST "/accounts/${CF_ACCOUNT_ID}/queues/${QUEUE_ID}/consumers" '{"type":"http_pull"}')"
if jq -e '.success' >/dev/null <<<"$resp"; then
	log "  configured via API"
else
	warn "API http_pull failed; falling back to wrangler"
	(cd "$ROOT/cron" && npx --yes wrangler queues consumer http add "$CF_QUEUE_NAME")
fi

# ------------------------------------------------------------- DB migration --
log "Applying Neon migration"
psql "$LOGS_DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f "$ROOT/db/migrations/001_init.sql" >/dev/null
log "  schema ready"

# ---------------------------------------------------------------- Logpush ----
log "Registering Logpush http_requests job"
DESTINATION_CONF="r2://${R2_LOGS_BUCKET}/${R2_PREFIX}{DATE}?account-id=${CF_ACCOUNT_ID}&access-key-id=${R2_ACCESS_KEY_ID}&secret-access-key=${R2_SECRET_ACCESS_KEY}"

resp="$(cf_api POST "/zones/${CF_ZONE_ID}/logpush/ownership" "$(jq -cn --arg d "$DESTINATION_CONF" '{destination_conf:$d}')")"
CHALLENGE_FILE="$(jq -r '.result.filename // empty' <<<"$resp")"
[[ -n "$CHALLENGE_FILE" ]] || die "ownership challenge request failed: $resp"

read_challenge() {
	local key=$1
	if command -v aws >/dev/null; then
		AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
		AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
		AWS_DEFAULT_REGION=auto \
			aws s3api get-object --bucket "$R2_LOGS_BUCKET" --key "$key" \
			--endpoint-url "https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com" /dev/stdout 2>/dev/null && return 0
	fi
	(cd "$ROOT/cron" && npx --yes wrangler r2 object get "${R2_LOGS_BUCKET}/${key}" --pipe 2>/dev/null) && return 0
	return 1
}

TOKEN="$(read_challenge "$CHALLENGE_FILE" | tr -d '\r\n' || true)"
if [[ -z "$TOKEN" ]]; then
	warn "challenge file not found at '${CHALLENGE_FILE}'; trying under '${R2_PREFIX}'"
	TOKEN="$(read_challenge "${R2_PREFIX}${CHALLENGE_FILE}" | tr -d '\r\n' || true)"
fi
[[ -n "$TOKEN" ]] || die "could not read ownership challenge file; check R2 credentials/bucket"

resp="$(cf_api POST "/zones/${CF_ZONE_ID}/logpush/ownership/validate" \
	"$(jq -cn --arg d "$DESTINATION_CONF" --arg t "$TOKEN" '{destination_conf:$d,ownership_challenge:$t}')")"
jq -e '.success' >/dev/null <<<"$resp" || die "ownership challenge validation failed: $resp"

JOB_BODY="$(cat "$ROOT/infra/logpush.json.tmpl")"
JOB_BODY="${JOB_BODY/__DESTINATION_CONF__/$DESTINATION_CONF}"
JOB_BODY="${JOB_BODY/__OWNERSHIP_CHALLENGE__/$TOKEN}"

resp="$(cf_api POST "/zones/${CF_ZONE_ID}/logpush/jobs" "$JOB_BODY")"
if jq -e '.success' >/dev/null <<<"$resp"; then
	log "  job created"
else
	warn "job creation returned: $(jq -c '.errors' <<<"$resp")"
	warn "if it already exists, delete it in the dashboard and re-run, or update it via the API"
fi

# ------------------------------------------------------------------- Fly -----
log "Deploying Fly worker: ${FLY_APP}"
command -v flyctl >/dev/null || die "flyctl is required"
flyctl auth whoami >/dev/null 2>&1 || die "run 'flyctl auth login' first"

if flyctl apps list --json | jq -e --arg a "$FLY_APP" '.[]? | select(.Name == $a)' >/dev/null; then
	log "  app exists"
else
	# shellcheck disable=SC2086
	flyctl apps create "$FLY_APP" ${FLY_ORG:+--org "$FLY_ORG"}
fi

flyctl secrets set --app "$FLY_APP" --stage \
	DATABASE_URL="$LOGS_DATABASE_URL" \
	R2_ACCOUNT_ID="$R2_ACCOUNT_ID" \
	R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
	R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
	CF_ACCOUNT_ID="$CF_ACCOUNT_ID" \
	CF_QUEUE_ID="$QUEUE_ID" \
	CF_QUEUE_API_TOKEN="$CF_QUEUE_API_TOKEN" >/dev/null
log "  secrets staged"

(cd "$ROOT" && flyctl deploy --app "$FLY_APP" --config fly.toml \
	--dockerfile worker/Dockerfile --ha=false)

MACHINE_ID="$(flyctl machine list --app "$FLY_APP" --json | jq -r '.[0].id // empty')"
[[ -n "$MACHINE_ID" ]] || die "no Fly machine found after deploy"
flyctl machine update "$MACHINE_ID" --app "$FLY_APP" --restart no --yes >/dev/null
log "  machine ${MACHINE_ID} set to restart=no"

# ------------------------------------------------------------------ cron -----
log "Deploying cron worker"
(cd "$ROOT/cron" && npx --yes wrangler deploy)

cat <<EOF

Setup complete.

Next steps:
  1. Set the cron worker secret:
       (cd $ROOT/cron && npx wrangler secret put FLY_API_TOKEN)
  2. Set the machine id in $ROOT/cron/wrangler.toml:
       FLY_MACHINE_ID = "${MACHINE_ID}"
     then redeploy:  (cd $ROOT/cron && npx wrangler deploy)
  3. Manually trigger a run to verify:
       curl -X POST https://pagex-logs-cron.<your-subdomain>.workers.dev/start
     and check:  flyctl logs --app $FLY_APP
  4. Verify aggregates in Neon:
       SELECT host, hour, requests, bytes, cache_hits FROM usage_hourly ORDER BY hour DESC LIMIT 20;

Notes:
  - Cron Triggers require the Workers Paid plan. On the free plan, drive the
    cron worker's POST /start endpoint from an external scheduler.
  - Logpush may take a few minutes to emit the first file.
EOF
