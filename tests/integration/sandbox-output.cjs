'use strict';

async function main() {
  const address = 'http://127.0.0.1:5050';
  const response = await fetch(`${address}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: [{
      args: ['/usr/bin/head', '-c', '3145728', '/dev/zero'],
      env: ['PATH=/usr/bin:/bin', 'HOME=/w'],
      files: [{ content: '' }, { name: 'stdout', max: 2097152 }, { name: 'stderr', max: 2097152 }],
      cpuLimit: 10000000000, clockLimit: 30000000000, memoryLimit: 268435456, procLimit: 32,
      copyOutCached: ['stdout', 'stderr'], copyOutMax: 6291456,
    }] }),
    signal: AbortSignal.timeout(45000),
  });
  if (!response.ok) throw new Error(`sandbox HTTP ${response.status}`);
  const [result] = await response.json();
  for (const id of Object.values(result.fileIds || {})) {
    await fetch(`${address}/file/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }
  console.log(JSON.stringify({ status: result.status, error: result.error, memory: result.memory,
    time: result.time, fileError: result.fileError }, null, 2));
  if (result.status !== 'Output Limit Exceeded') process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
