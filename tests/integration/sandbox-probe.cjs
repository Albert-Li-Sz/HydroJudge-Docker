'use strict';

const assert = require('node:assert/strict');

async function call(path, body) {
  const response = await fetch(`http://127.0.0.1:5050/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.ok, true, `${path}: HTTP ${response.status}`);
  return response.json();
}

async function main() {
  const version = await call('version');
  const config = await call('config');
  assert.equal(config.runnerConfig?.seccomp, true, 'Sandbox seccomp must be enabled');
  assert.ok([1, 2].includes(config.runnerConfig?.cgroupType), 'cgroup must be enabled');
  assert.ok(config.runnerConfig.cgroupControllers.includes('memory'), 'memory cgroup is required');
  assert.ok(config.runnerConfig.cgroupControllers.includes('pids'), 'pids cgroup is required');
  const results = await call('run', { cmd: [{
    args: ['/bin/bash', '-c', 'ulimit -s; /usr/bin/python3 -c "import resource; print(resource.getrlimit(resource.RLIMIT_FSIZE)[0])"'],
    env: ['PATH=/usr/bin:/bin', 'HOME=/w'],
    files: [{ content: '' }, { name: 'stdout', max: 1024 }, { name: 'stderr', max: 1024 }],
    cpuLimit: 5000000000,
    clockLimit: 15000000000,
    memoryLimit: 134217728,
    procLimit: 32,
  }] });
  assert.equal(results[0]?.status, 'Accepted', JSON.stringify(results));
  const [stackLimit, fileSizeLimit] = results[0]?.files?.stdout?.trim().split('\n') || [];
  assert.equal(stackLimit, 'unlimited', 'Stack limit must be unlimited');
  assert.equal(Number(fileSizeLimit), 256 * 1024 * 1024, 'Keep the upstream 256 MiB regular-file limit');
  console.log(JSON.stringify({ version: version.buildVersion, seccomp: config.runnerConfig.seccomp,
    cgroup: config.runnerConfig.cgroupType, controllers: config.runnerConfig.cgroupControllers,
    stackLimit, fileSizeLimitBytes: Number(fileSizeLimit) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
