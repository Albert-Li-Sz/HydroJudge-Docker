'use strict';

// Exercise the actual installed HydroJudge client against deterministic sandbox
// responses. Real cgroup/file-limit behavior is tested separately in Linux.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const requireJudge = createRequire('/opt/hydrojudge/package.json');
const yaml = requireJudge('js-yaml');

async function main() {
  const dir = fs.mkdtempSync('/tmp/hydrojudge-policy-');
  const input = path.join(dir, 'judge.yaml');
  const base = { hosts: { main: { server_url: 'https://hydro-validation.invalid/', uname: 'judge', password: 'temporary-local-validation' } } };
  function prepare(extra = {}, valid = true) {
    fs.writeFileSync(input, yaml.dump({ ...base, ...extra }), { mode: 0o600 });
    const child = spawnSync(process.execPath, ['/opt/hydrojudge/runtime/prepare-config.cjs'], {
      env: { ...process.env, CONFIG_FILE: input }, encoding: 'utf8',
    });
    if (!valid) {
      assert.notEqual(child.status, 0, `Invalid rate ${String(extra.rate)} was accepted`);
      assert.match(child.stderr, /rate must be a finite positive number/);
      return;
    }
    assert.equal(child.status, 0, child.stderr);
    return yaml.load(fs.readFileSync('/run/hydrojudge/judge.yaml', 'utf8'));
  }
  const defaults = prepare();
  assert.equal(defaults.stdio_size, '256m');
  assert.equal(defaults.rerun, 2);
  assert.equal(fs.existsSync('/run/hydrojudge/output-limit'), false);
  console.log('PASS: official installer defaults: stdio_size=256m, rerun=2');
  for (const rate of [0, -1, NaN, Infinity, '1']) prepare({ rate }, false);
  assert.equal(prepare({ rate: 0.75 }).rate, 0.75);
  prepare();
  console.log('PASS: invalid rates rejected; positive fractional calibration retained');

  process.env.CONFIG_FILE = '/run/hydrojudge/judge.yaml';
  let pending;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/version') return res.end(JSON.stringify({ buildVersion: 'v1.13.3', copyOutOptional: true }));
    if (req.url === '/run') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks)));
      return res.end(JSON.stringify([pending]));
    }
    res.writeHead(404).end('{}');
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5050, '127.0.0.1', resolve); });
  try {
    requireJudge('@hydrooj/register');
    const { runQueued } = requireJudge('@hydrooj/hydrojudge/src/sandbox.ts');
    for (const [name, status, time, memory, fileError, expected, filename] of [
      ['accepted', 'Accepted', 1000000, 1048576, [], 1],
      ['sandbox OLE', 'Output Limit Exceeded', 1000000, 1048576, [], 5],
      ['file OLE with copy-out failure', 'Output Limit Exceeded', 1000000, 268435456,
        [{ name: 'sum.out', type: 'CopyOutSizeExceeded' }], 5, 'sum'],
      ['copy-out OLE without sandbox OLE', 'File Error', 1000000, 1048576,
        [{ name: 'sum.out', type: 'CopyOutSizeExceeded' }], 5, 'sum'],
      ['genuinely missing output remains RE', 'File Error', 1000000, 1048576,
        [{ name: 'sum.out', type: 'CopyOutOpen' }], 6, 'sum'],
      ['OLE priority over TLE', 'Time Limit Exceeded', 1200000000, 1048576, [{ name: 'stdout', type: 'CollectSizeExceeded' }], 5],
      ['OLE priority over MLE', 'Memory Limit Exceeded', 1000000, 9437184, [{ name: 'stderr', type: 'CollectSizeExceeded' }], 5],
      ['MLE without overflow', 'Memory Limit Exceeded', 1000000, 9437184, [], 4],
      ['TLE without overflow', 'Time Limit Exceeded', 1200000000, 1048576, [], 3],
    ]) {
      pending = { status, time, memory, exitStatus: 0, files: { stdout: '', stderr: '' }, fileIds: {}, fileError };
      const result = await runQueued('/bin/true', { time: 1000, memory: filename ? 512 : 8,
        cacheStdoutAndStderr: true, ...(filename ? { filename } : {}) });
      assert.equal(result.status, expected, name);
      const command = requests.at(-1).cmd[0];
      for (const stream of command.files.slice(1)) {
        assert.equal(Object.hasOwn(stream, 'pipe'), false, 'retain upstream file collectors');
        assert.equal(stream.max, 256 * 1024 * 1024);
      }
      await result[Symbol.asyncDispose]();
      console.log(`PASS: ${name}; upstream file collectors retained`);
    }
    const custom = prepare({ stdio_size: '16m', rerun: 0 });
    assert.equal(custom.stdio_size, '16m');
    assert.equal(custom.rerun, 0);
    console.log('PASS: explicit stdio_size/rerun overrides preserved');
    const { overrideConfig } = requireJudge('@hydrooj/hydrojudge/src/config.ts');
    overrideConfig(custom);
    pending = { status: 'Accepted', time: 1000000, memory: 1048576, exitStatus: 0,
      files: { stdout: '', stderr: '' }, fileIds: { 'sum.out': 'fixture-file' } };
    await runQueued('/bin/true', { filename: 'sum', cacheStdoutAndStderr: true });
    assert.ok(requests.at(-1).cmd[0].copyOutMax >= 256 * 1024 * 1024,
      'Small standard-stream limits must not shrink regular-file copy-out');
    assert.equal(requests.at(-1).cmd[0].files[1].max, 16 * 1024 * 1024);
    console.log('PASS: 16 MiB streams preserve the 256 MiB regular-file copy-out limit');
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
