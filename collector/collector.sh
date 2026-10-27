#!/usr/bin/env bash
# Read-only local metrics; writes ONLY beneath HOMEPAGE_ROOT (default /srv/homepage).
# No default network inventory, VM enumeration, command arguments or disk serials.
set -euo pipefail
umask 077
BASE=${HOMEPAGE_ROOT:-/srv/homepage}
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
OUT=$BASE/www/data
RAW=$BASE/raw
mkdir -p "$OUT" "$RAW" "$BASE/run"
chmod 700 "$RAW" "$BASE/run"
chmod 755 "$BASE/www" "$OUT"
exec 9>"$BASE/run/collector.lock"
flock -n 9 || exit 0

cat /proc/loadavg > "$RAW/loadavg"
nproc > "$RAW/cores"
free -b | grep '^Mem:' > "$RAW/mem"
free -b | grep '^Swap:' > "$RAW/swap"
cut -d' ' -f1 /proc/uptime > "$RAW/uptime"
timeout 4 sensors 2>/dev/null | grep -m1 'Package id 0' > "$RAW/cputemp" || : > "$RAW/cputemp"
timeout 4 nvidia-smi --query-gpu=index,name,uuid,memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits > "$RAW/gpus" 2>/dev/null || : > "$RAW/gpus"
timeout 4 nvidia-smi --query-compute-apps=pid,gpu_uuid,used_memory --format=csv,noheader,nounits > "$RAW/gpu_apps" 2>/dev/null || : > "$RAW/gpu_apps"
for name in vms disks.ini super.dat sync_action voice_health; do : > "$RAW/$name"; done

: > "$RAW/mounts"
# Explicit opt-in, newline-delimited mount list outside the repository.
if [[ -n ${COLLECTOR_MOUNTS_FILE:-} ]]; then
  while IFS= read -r mount || [[ -n $mount ]]; do
    [[ -z $mount || $mount == \#* ]] && continue
    [[ $mount == /* && $mount != *[[:space:]]* ]] || { printf 'Invalid mount entry\n' >&2; exit 1; }
    line=$(df -B1 --output=size,used,pcent -- "$mount" | tail -n 1)
    printf '%s %s\n' "$mount" "$line" >> "$RAW/mounts"
  done < "$COLLECTOR_MOUNTS_FILE"
fi

: > "$RAW/apps"
# Optional file: service-id URL. Never eval or source configuration. TLS verified.
if [[ -n ${COLLECTOR_SERVICES_FILE:-} ]]; then
  while read -r name url rest; do
    [[ -z $name || $name == \#* ]] && continue
    [[ $name =~ ^[a-zA-Z0-9_-]+$ && $url =~ ^https?:// && -z $rest ]] || { printf 'Invalid service entry\n' >&2; exit 1; }
    code=$(curl --noproxy '*' --proto '=http,https' -s -o /dev/null -w '%{http_code}' --max-time 3 "$url") || code=000
    printf '%s %s\n' "$name" "$code" >> "$RAW/apps"
  done < "$COLLECTOR_SERVICES_FILE"
fi

date +%s > "$RAW/ts"
node "$SCRIPT_DIR/build.js" "$RAW" > "$OUT/status.json.tmp"
chmod 644 "$OUT/status.json.tmp"
mv -- "$OUT/status.json.tmp" "$OUT/status.json"
