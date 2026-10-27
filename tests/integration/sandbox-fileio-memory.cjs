'use strict';

// Demonstrate the upstream tmpfs accounting policy in a low/high memory pair.
async function main() {
  const address = 'http://127.0.0.1:5050';
  const results = [];
  for (const limitMiB of [8, 32]) {
    const response = await fetch(`${address}/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cmd: [{
        args: ['/bin/bash', '-c', '/usr/bin/head -c 12582912 /dev/zero > /w/sum.out'],
        env: ['PATH=/usr/bin:/bin', 'HOME=/w'],
        files: [{ content: '' }, { name: 'stdout', max: 1024 }, { name: 'stderr', max: 1024 }],
        cpuLimit: 5000000000, clockLimit: 15000000000, memoryLimit: limitMiB * 1024 * 1024, procLimit: 32,
        copyOutCached: ['sum.out'], copyOutMax: 16777216,
      }] }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) throw new Error(`sandbox HTTP ${response.status}`);
    const [result] = await response.json();
    results.push({ limitMiB, status: result.status, memoryKiB: Math.round(result.memory / 1024) });
    for (const id of Object.values(result.fileIds || {})) {
      await fetch(`${address}/file/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
  }
  console.log(JSON.stringify(results, null, 2));
  if (results[0].status !== 'Memory Limit Exceeded' || results[1].status !== 'Accepted') process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
