'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const requireJudge = createRequire('/opt/hydrojudge/package.json');
const { WebSocketServer } = requireJudge('ws');
require('./fast-retry.cjs');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (predicate()) return;
    await pause(10);
  }
  assert.fail('Session fixture timed out');
}

async function main() {
  const dir = fs.mkdtempSync('/tmp/hydrojudge-session-');
  const messages = [];
  let upgrades = 0;
  let starts = 0;
  let host;
  const server = http.createServer(async (req, res) => {
    for await (const chunk of req) { /* Drain fixture credentials. */ }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/login') res.setHeader('Set-Cookie', 'sid=fixture-session; Path=/; HttpOnly');
    res.end(JSON.stringify(req.url === '/login' || req.headers.cookie ? {} : { url: '/login' }));
  });
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    upgrades++;
    sockets.handleUpgrade(req, socket, head, (ws) => {
      ws.on('message', (data) => {
        const message = JSON.parse(String(data));
        messages.push(message);
        if (message.key === 'start') starts++;
      });
    });
  });
  try {
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const config = { type: 'hydro', host: 'fixture', server_url: `http://127.0.0.1:${server.address().port}/`,
      uname: 'fixture', password: 'temporary-test-password', noStatus: true };
    fs.writeFileSync(path.join(dir, 'judge.yaml'), JSON.stringify({ hosts: { main: config } }));
    const prep = spawnSync(process.execPath, ['/opt/hydrojudge/runtime/prepare-config.cjs'], {
      env: { ...process.env, CONFIG_FILE: path.join(dir, 'judge.yaml') }, encoding: 'utf8',
    });
    assert.equal(prep.status, 0, prep.stderr);
    process.env.CONFIG_FILE = '/run/hydrojudge/judge.yaml';
    requireJudge('@hydrooj/register');
    const Hydro = requireJudge('@hydrooj/hydrojudge/src/hosts/hydro.ts').default;
    host = new Hydro(config);
    await host.init();
    const queue = { add: () => { throw new Error('No tasks are sent by this fixture'); } };
    await host.consume(queue);
    await until(() => starts === 1);
    const oldReporter = host.getReporter({ meta: {}, request: { rid: 'old-session-record' } });
    for (const socket of sockets.clients) socket.terminate();
    await until(() => starts === 2);
    oldReporter.end({ status: 1 });
    host.getReporter({ meta: {}, request: { rid: 'current-session-record' } }).end({ status: 1 });
    await until(() => messages.some((message) => message.rid === 'current-session-record'));
    assert.equal(messages.some((message) => message.rid === 'old-session-record'), false,
      'Old results must not be reported through a replacement session');
    for (const socket of sockets.clients) socket.terminate();
    await until(() => !host.ws);
    host.dispose();
    const before = upgrades;
    await pause(350);
    assert.equal(upgrades, before, 'Disposal must cancel pending reconnects');
    console.log(JSON.stringify({ passed: true, checks: ['old reporters cannot use a new session',
      'new reporters remain functional', 'disposal cancels reconnects'], upgrades }));
  } finally {
    host?.dispose();
    for (const socket of sockets.clients) socket.terminate();
    server.closeAllConnections();
    server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
