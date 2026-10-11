#!/usr/bin/env bash
# Lapor status build ke situs: notify.sh building|done|failed [pesan]
# Butuh env: ORDER_ID, RUN_URL, SITE_URL, BUILD_SECRET. Tidak pernah menggagalkan workflow.
set -u
STATUS="${1:?status}"
MSG="${2:-}"
if [ -z "${SITE_URL:-}" ] || [ -z "${BUILD_SECRET:-}" ]; then
  echo "SITE_URL / BUILD_SECRET belum diatur, lewati callback."
  exit 0
fi
BODY=$(jq -n --arg id "$ORDER_ID" --arg s "$STATUS" --arg r "${RUN_URL:-}" --arg m "$MSG" \
  '{order_id:$id,status:$s,run_url:$r,message:$m}')
curl -sS --max-time 20 --retry 2 -X POST "${SITE_URL%/}/api/build" \
  -H "x-build-secret: $BUILD_SECRET" -H 'content-type: application/json' -d "$BODY" || true
echo
exit 0
