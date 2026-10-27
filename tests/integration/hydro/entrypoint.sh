#!/usr/bin/env bash
set -euo pipefail
mkdir -p /root/.hydro
printf '%s\n' '{"uri":"mongodb://mongo:27017/hydro_validation"}' > /root/.hydro/config.json
printf '%s\n' '["@hydrooj/ui-default"]' > /root/.hydro/addon.json
if [[ ! -f /qa/manifest.json ]]; then
  hydrooj cli execute "return await require('/tests/seed.cjs')(global.Hydro)"
fi
test -s /qa/manifest.json
exec hydrooj
