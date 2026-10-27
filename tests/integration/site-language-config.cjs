'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const WebSocket = require('/opt/hydrojudge/node_modules/ws');

async function main() {
  const credentials = JSON.parse(fs.readFileSync('/qa/credentials.json', 'utf8'));
  const response = await fetch('http://site:8888/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ uname: 'qa-judge', password: credentials.judge }),
  });
  assert.equal(response.ok, true, `Login HTTP ${response.status}`);
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');
  const language = await new Promise((resolve, reject) => {
    const socket = new WebSocket('ws://site:8888/judge/conn', { headers: { Cookie: cookie } });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error('Site did not send language configuration within 10 seconds'));
    }, 10000);
    socket.on('error', (error) => { clearTimeout(timer); reject(error); });
    socket.on('message', (text) => {
      try {
        const message = JSON.parse(String(text));
        if (message.language) {
          clearTimeout(timer);
          socket.close();
          resolve(message.language);
        }
      } catch (error) { clearTimeout(timer); socket.terminate(); reject(error); }
    });
  });
  assert.match(language.c?.compile || '', /-DQA_FROM_OJ=42/);
  assert.equal(language.c.compile_time_limit, 60000);
  assert.equal(language.java?.compile_time_limit, 120000);
  assert.equal(language['py.pypy3']?.compile_time_limit, 60000);
  console.log(JSON.stringify({ passed: true, cCompile: language.c.compile,
    compileLimitsMs: { c: language.c.compile_time_limit, java: language.java.compile_time_limit,
      pypy: language['py.pypy3'].compile_time_limit } }, null, 2));
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
