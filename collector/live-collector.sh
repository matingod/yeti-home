#!/usr/bin/env bash
# One bounded minute worker. Independent from the slower status collector.
set -euo pipefail
umask 077
BASE=${HOMEPAGE_ROOT:-/srv/homepage}
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
mkdir -p "$BASE/run" "$BASE/www/data"
chmod 700 "$BASE/run"
chmod 755 "$BASE/www" "$BASE/www/data"
exec 9>"$BASE/run/live-collector.lock"
flock -n 9 || exit 0
started=$SECONDS
for tick in 0 10 20 30 40 50; do
  delay=$((started + tick - SECONDS))
  if (( delay > 0 )); then
    timeout -k 1 11 sleep "$delay" || exit 1
  fi
  timeout -k 1 8 node "$SCRIPT_DIR/build-live.js" --write "$BASE/www/data/live.json" || true
done
