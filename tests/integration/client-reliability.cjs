'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const requireJudge = createRequire('/opt/hydrojudge/package.json');
const { WebSocketServer } = requireJudge('ws');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mode = process.argv[2];
assert.ok(['multi-site', 'handshake', 'expired-session', 'handshake-auth'].includes(mode));

async function until(predicate, message, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await pause(20);
  }
  assert.fail(message);
}

async function main() {
  const folder = fs.mkdtempSync('/tmp/hydrojudge-reliability-');
  let recovered = false;
  let failedLogins = 0;
  let upgrades = 0;
  let handshakeFailures = 0;
  const session = {};
  const loginCounts = {};
  const active = {};
  const starts = {};
  let maxActive = 0;
  let logs = '';
  let child;
  const site = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* Consume the fixture login body. */ }
    const name = req.url.split('/')[1];
    res.setHeader('Content-Type', 'application/json');
    if (name === 'bad' && !recovered) {
      if (req.url.endsWith('/login')) failedLogins++;
      res.writeHead(503).end('{}');
    } else if (req.url.endsWith('/login')) {
      loginCounts[name] = (loginCounts[name] || 0) + 1;
      session[name] = `fixture-${name}-${loginCounts[name]}`;
      res.setHeader('Set-Cookie', `sid=${session[name]}; Path=/; HttpOnly`);
      res.end('{}');
    } else {
      res.end(JSON.stringify(((mode === 'handshake-auth' && loginCounts[name]) || req.headers.cookie?.includes(`sid=${session[name]}`))
        ? {} : { url: '/login' }));
    }
  });
  const sockets = new WebSocketServer({ noServer: true });
  site.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {}); // A rejected fixture handshake may reset its TCP socket.
    upgrades++;
    const name = req.url.split('/')[1];
    const reject = mode === 'handshake' && upgrades === 1 ? 503
      : req.headers.authorization !== `Bearer ${session[name]}` ? 401 : 0;
    if (reject) {
      handshakeFailures++;
      socket.end(`HTTP/1.1 ${reject} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    sockets.handleUpgrade(req, socket, head, (ws) => {
      active[name] = (active[name] || 0) + 1;
      maxActive = Math.max(maxActive, active[name]);
      ws.on('close', () => active[name]--);
      ws.on('message', (data) => {
        if (JSON.parse(String(data)).key === 'start') starts[name] = (starts[name] || 0) + 1;
      });
    });
  });
  const sandbox = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url === '/version' ? { buildVersion: 'v1.13.3', copyOutOptional: true }
      : { fixSymlinkEscape: true, runnerConfig: { seccomp: true, cgroupType: 2, cgroupControllers: ['cpu', 'memory', 'pids'] } }));
  });
  try {
    await new Promise((resolve) => site.listen(0, '127.0.0.1', resolve));
    await new Promise((resolve) => sandbox.listen(5050, '127.0.0.1', resolve));
    const host = (name) => ({ server_url: `http://127.0.0.1:${site.address().port}/${name}/`,
      uname: 'fixture', password: 'temporary-test-password', noStatus: true });
    fs.writeFileSync(path.join(folder, 'input.yaml'), JSON.stringify({ hosts: mode === 'multi-site'
      ? { good: host('good'), bad: host('bad') } : { good: host('good') } }));
    const prep = spawnSync(process.execPath, ['/opt/hydrojudge/runtime/prepare-config.cjs'], {
      env: { ...process.env, CONFIG_FILE: path.join(folder, 'input.yaml') }, encoding: 'utf8',
    });
    assert.equal(prep.status, 0, prep.stderr);
    child = spawn(process.execPath, ['--require', path.join(__dirname, 'fast-retry.cjs'),
      '/opt/hydrojudge/node_modules/@hydrooj/hydrojudge/bin/hydrojudge.js'], {
      env: { ...process.env, CONFIG_FILE: '/run/hydrojudge/judge.yaml' }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk) => { logs += chunk; });
    child.stderr.on('data', (chunk) => { logs += chunk; });
    if (mode === 'multi-site') {
      await until(() => failedLogins && starts.good, 'Healthy site was blocked by another site login failure');
      recovered = true;
      await until(() => starts.bad, 'Recovered site did not reconnect without restarting the daemon');
    } else {
      await until(() => starts.good, 'Judge did not start after a transient handshake failure');
      if (['expired-session', 'handshake-auth'].includes(mode)) {
        session.good = 'invalidated-session';
        for (const socket of sockets.clients) socket.close(1008, 'session expired');
        await until(() => handshakeFailures || starts.good === 2, 'Reconnect was not attempted');
        await until(() => starts.good === 2, 'Expired session did not reauthenticate and resume', 1000);
        assert.equal(loginCounts.good, 2);
      }
    }
    await pause(400);
    assert.equal(maxActive, 1, 'More than one connection remained active for a site');
    assert.equal(logs.includes('Unhandled Rejection'), false, 'A connection callback rejected without handling');
    assert.equal(logs.includes('WebSocket is not open'), false);
    if (mode === 'handshake') {
      assert.equal(handshakeFailures, 1);
      assert.equal(upgrades, 2, 'One failed handshake must schedule exactly one reconnect');
    }
    if (mode === 'multi-site') assert.equal(starts.good, 1);
    console.log(JSON.stringify({ passed: true, mode, upgrades, handshakeFailures, loginCounts, starts, maxActive }));
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await until(() => child.exitCode !== null || child.signalCode !== null, 'Daemon did not stop', 2000)
        .catch(() => child.kill('SIGKILL'));
    }
    for (const socket of sockets.clients) socket.terminate();
    site.closeAllConnections();
    sandbox.closeAllConnections();
    site.close();
    sandbox.close();
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
