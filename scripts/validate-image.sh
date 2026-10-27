#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
architecture="$(docker info --format '{{.Architecture}}')"
if [[ "$architecture" != x86_64 && "$architecture" != amd64 ]]; then
  echo 'Run integration validation on an amd64 Linux Docker host.' >&2
  exit 1
fi
network=hydrojudge-validation-net
if docker network inspect "$network" >/dev/null 2>&1; then
  echo 'The validation network already exists; stop the previous test environment first.' >&2
  exit 1
fi
if [[ -e .local-test/qa/manifest.json ]]; then
  echo 'Use a clean test workspace without a previous .local-test/qa/manifest.json.' >&2
  exit 1
fi
compose=(docker compose -p hydrojudge-validation -f tests/integration/compose.yml)
mkdir -p .local-test/qa
cleanup() {
  local status=$?
  if (( status != 0 )); then
    "${compose[@]}" ps -a >&2 || true
    "${compose[@]}" logs --no-color --tail 80 > .local-test/qa/diagnostics.raw 2>&1 || true
    python3 -B - <<'PY' || true
import json, re
from pathlib import Path
qa = Path('.local-test/qa')
text = (qa / 'diagnostics.raw').read_text()
if (qa / 'credentials.json').exists():
    for secret in json.loads((qa / 'credentials.json').read_text()).values():
        text = text.replace(secret, '[REDACTED]')
text = re.sub(r'(?i)(Bearer\s+|sid=)[^\s;\"\x27,}]+', r'\1[REDACTED]', text)
(qa / 'diagnostics.log').write_text(text)
print(text)
PY
  fi
  "${compose[@]}" down -v --remove-orphans || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create "$network" >/dev/null
python3 -B - <<'PY'
import json, subprocess
from pathlib import Path
info = json.loads(subprocess.check_output(['docker', 'info', '--format', '{{json .}}']))
keys = ['Architecture', 'KernelVersion', 'OperatingSystem', 'ServerVersion', 'CgroupVersion']
Path('.local-test/qa/environment.json').write_text(json.dumps({key: info.get(key) for key in keys}, indent=2) + '\n')
PY

docker run --rm --platform linux/amd64 \
  -v "$project_dir/tests/integration:/tests:ro" \
  hydrojudge:validation node /tests/client-output-policy.cjs | tee .local-test/qa/client-policy.log
python3 -B tests/integration/run.py prepare --profile defaults
"${compose[@]}" up -d --build --wait --wait-timeout 180 mongo site
"${compose[@]}" up -d --no-build --no-recreate --wait --wait-timeout 180 judge

for probe in sandbox-probe sandbox-languages sandbox-output sandbox-fileio-memory sandbox-process-limit; do
  "${compose[@]}" exec -T judge node - < "tests/integration/$probe.cjs" | tee ".local-test/qa/$probe.log"
done
python3 -B tests/integration/default-limits.py
python3 -B tests/integration/run.py prepare --profile resource
"${compose[@]}" restart judge
"${compose[@]}" up -d --no-build --no-recreate --wait --wait-timeout 180 judge
python3 -B tests/integration/run.py run
python3 -B tests/integration/language-filter.py
python3 -B tests/integration/concurrency.py
python3 -B tests/integration/pretest.py
