'use strict';

const fs = require('node:fs');
const checkSandbox = require('./check-sandbox.cjs');

async function main() {
  const pids = JSON.parse(fs.readFileSync('/run/hydrojudge/pids.json', 'utf8'));
  for (const name of ['sandbox', 'judge']) {
    if (!Number.isSafeInteger(pids[name]) || pids[name] < 1) throw new Error(`${name} PID is missing`);
    process.kill(pids[name], 0);
  }
  await checkSandbox();
}

main().catch((error) => {
  console.error(`[healthcheck] ${error.message}`);
  process.exitCode = 1;
});
