'use strict';

const assert = require('node:assert/strict');

async function run(procLimit) {
  const program = [
    'import os',
    'try:',
    ' p = os.fork()',
    ' if p == 0: os._exit(0)',
    ' os.waitpid(p, 0)',
    ' print("fork allowed")',
    'except OSError as e:',
    ' print("fork blocked", e.errno)',
  ].join('\n');
  const response = await fetch('http://127.0.0.1:5050/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: [{
      args: ['/usr/bin/python3', '-c', program],
      env: ['PATH=/usr/bin:/bin', 'HOME=/w'],
      files: [{ content: '' }, { name: 'stdout', max: 1024 }, { name: 'stderr', max: 1024 }],
      cpuLimit: 5000000000, clockLimit: 15000000000, memoryLimit: 128 * 1024 * 1024, procLimit,
    }] }),
    signal: AbortSignal.timeout(45000),
  });
  assert.equal(response.ok, true, `sandbox HTTP ${response.status}`);
  const [result] = await response.json();
  assert.equal(result.status, 'Accepted', JSON.stringify(result));
  return result.files.stdout.trim();
}

async function main() {
  const blocked = await run(1);
  const allowed = await run(2);
  assert.equal(blocked, 'fork blocked 11');
  assert.equal(allowed, 'fork allowed');
  console.log(JSON.stringify([{ procLimit: 1, result: blocked }, { procLimit: 2, result: allowed }], null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
