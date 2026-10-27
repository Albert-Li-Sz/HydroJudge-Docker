#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ "${1:-run}" != run ]]; then
  exec "$@"
fi

if [[ "$(id -u)" != 0 ]]; then
  echo '[entrypoint] Run this image as root with privileged mode enabled' >&2
  exit 1
fi
if [[ "$(uname -m)" != x86_64 ]]; then
  echo '[entrypoint] Only linux/amd64 is supported' >&2
  exit 1
fi
shm_kb="$(df -Pk /dev/shm | awk 'NR == 2 {print $2}')"
if [[ ! "$shm_kb" =~ ^[0-9]+$ ]] || (( shm_kb < 262144 )); then
  echo '[entrypoint] Configure at least 256 MiB /dev/shm; the Compose default is 1 GiB' >&2
  exit 1
fi
ulimit -s unlimited
node /opt/hydrojudge/runtime/prepare-config.cjs
export CONFIG_FILE=/run/hydrojudge/judge.yaml
# The upstream override is merged after CONFIG_FILE; keep the validated config authoritative.
unset OVERRIDE_CONFIG EXECUTION_HOST
IFS= read -r parallelism < /run/hydrojudge/parallelism
mount_config="${MOUNT_CONFIG_FILE:-/config/mount.yaml}"
if [[ -z "${MOUNT_CONFIG_FILE:-}" && ! -f "$mount_config" ]]; then
  mount_config=/opt/hydrojudge/mount.yaml
fi
if [[ ! -f "$mount_config" ]]; then
  echo '[entrypoint] Sandbox mount configuration does not exist' >&2
  exit 1
fi

sandbox_pid=''
judge_pid=''
# Invoked indirectly by the EXIT trap; no direct call is needed.
# shellcheck disable=SC2329
cleanup() {
  trap - EXIT TERM INT
  local pid attempt
  rm -f /run/hydrojudge/pids.json
  for pid in "$judge_pid" "$sandbox_pid"; do
    [[ -z "$pid" ]] || kill -TERM "$pid" 2>/dev/null || true
  done
  for ((attempt = 0; attempt < 10; attempt++)); do
    if ! { [[ -n "$judge_pid" ]] && kill -0 "$judge_pid" 2>/dev/null; } \
        && ! { [[ -n "$sandbox_pid" ]] && kill -0 "$sandbox_pid" 2>/dev/null; }; then
      break
    fi
    sleep 1
  done
  for pid in "$judge_pid" "$sandbox_pid"; do
    if [[ -n "$pid" ]]; then
      kill -KILL "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap 'cleanup' EXIT
trap 'exit 0' TERM INT

go-judge \
  -mount-conf "$mount_config" \
  -http-addr 127.0.0.1:5050 \
  -parallelism "$parallelism" \
  -no-fallback &
sandbox_pid=$!

ready=false
for ((attempt = 0; attempt < 30; attempt++)); do
  if ! kill -0 "$sandbox_pid" 2>/dev/null; then
    echo '[entrypoint] Sandbox exited before becoming ready' >&2
    exit 1
  fi
  if node /opt/hydrojudge/runtime/check-sandbox.cjs >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  node /opt/hydrojudge/runtime/check-sandbox.cjs || true
  echo '[entrypoint] Sandbox did not become ready' >&2
  exit 1
fi

node /opt/hydrojudge/node_modules/@hydrooj/hydrojudge/bin/hydrojudge.js &
judge_pid=$!
printf '{"sandbox":%s,"judge":%s}\n' "$sandbox_pid" "$judge_pid" > /run/hydrojudge/pids.json
echo '[entrypoint] Sandbox and judge started; local health does not confirm a site connection'

set +e
wait -n "$sandbox_pid" "$judge_pid"
status=$?
set -e
echo "[entrypoint] A required process exited (status ${status}); stopping the container" >&2
if (( status == 0 )); then status=1; fi
exit "$status"
