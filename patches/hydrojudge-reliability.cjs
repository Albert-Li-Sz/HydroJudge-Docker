'use strict';

// Changes are deliberately tied to the reviewed 4.0.6 sources. An upstream
// update must be reviewed rather than silently accepting a partial patch.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = process.argv[2] || path.join(process.cwd(), 'node_modules', '@hydrooj', 'hydrojudge');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (metadata.version !== '4.0.6') throw new Error(`Review reliability patches for HydroJudge ${metadata.version}`);
const expected = {
  'daemon.ts': 'c81b7b81638a138687200268f730d332a01bd06ac46348704dee1de3f18aa76a',
  'hosts/hydro.ts': 'e7306b18fd12501e4436b85b36033864442918a40f18d40fb75bfed771d2f3d9',
  'task.ts': 'bc845377881d1bacb9292240dbd244bdb90bccd626bc5188601cb9aa59037f53',
};
const sources = {};
for (const [name, digest] of Object.entries(expected)) {
  sources[name] = fs.readFileSync(path.join(root, 'src', name), 'utf8');
  if (crypto.createHash('sha256').update(sources[name]).digest('hex') !== digest) {
    throw new Error(`HydroJudge ${name} differs from the reviewed source`);
  }
}
function replace(name, before, after) {
  if (sources[name].split(before).length !== 2) throw new Error(`Ambiguous patch in ${name}`);
  sources[name] = sources[name].replace(before, after);
}
function block(name, begin, end, replacement) {
  const start = sources[name].indexOf(begin);
  const finish = sources[name].indexOf(end, start + begin.length);
  if (start < 0 || finish < 0 || sources[name].split(begin).length !== 2) throw new Error(`Missing patch block in ${name}`);
  sources[name] = sources[name].slice(0, start) + replacement + sources[name].slice(finish);
}
const snippet = (name) => fs.readFileSync(path.join(__dirname, name), 'utf8');
block('daemon.ts', '    for (const i in _hosts) {', '\n}\n\nif (require.main', snippet('daemon-start.ts').trimEnd());

const host = 'hosts/hydro.ts';
replace(host, '    language: Record<string, LangConfig>;', `    language: Record<string, LangConfig>;
    private stopped = false;
    private connecting = false;
    private forceLogin = false;
    private retryTimer: ReturnType<typeof setTimeout>;`);
block(host, '    async init() {', '\n    async fetchFile', `    async init() {
        this.stopped = false;
        await this.setCookie(this.config.cookie || '');
        await this.ensureLogin();
    }
`);
replace(host, "send(rid: string, key: 'next' | 'end', data: Partial<JudgeResultBody>) {",
  "send(rid: string, key: 'next' | 'end', data: Partial<JudgeResultBody>, socket = this.ws) {\n        if (socket !== this.ws || socket?.readyState !== WebSocket.OPEN) return;");
replace(host, '        this.ws.send(JSON.stringify({ ...data, rid, key }));', '        socket.send(JSON.stringify({ ...data, rid, key }));');
replace(host, '    getReporter(t: JudgeTask) {', '    getReporter(t: JudgeTask) {\n        const socket = this.ws;');
replace(host, "this.send(t.request.rid, 'next', data);", "this.send(t.request.rid, 'next', data, socket);");
replace(host, "this.send(t.request.rid, 'end', data);", "this.send(t.request.rid, 'end', data, socket);");
block(host, '    async consume(queue: PQueue) {', '\n    dispose() {', snippet('host-consume.ts').trimEnd() + '\n');
block(host, '    dispose() {', '\n    async setCookie', `    dispose() {
        this.stopped = true;
        clearTimeout(this.retryTimer);
        this.retryTimer = undefined;
        this.ws?.terminate();
        this.ws = undefined;
    }
`);
replace(host, "            rememberme: 'on', judge: 'on',\n        });", "            rememberme: 'on', judge: 'on',\n        }).timeout({ response: 10000, deadline: 15000 });");
replace(host, "this.get('judge/files').set('Accept', 'application/json');", "this.get('judge/files').set('Accept', 'application/json').timeout({ response: 10000, deadline: 15000 });");
block(host, '    async retry(queue: PQueue) {', '\n}\n', `    async retry(queue: PQueue) {
        if (this.stopped || this.retryTimer) return;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = undefined;
            this.consume(queue).catch((error) => {
                log.error('Judge reconnect failed: %s', error.message);
                this.retry(queue);
            });
        }, 30000);
    }
`);

const task = 'task.ts';
replace(task, "compileCache: Record<string, Pick<Execute, 'execute' | 'copyIn' | typeof Symbol.asyncDispose>> = {};",
  "compileCache: Record<string, Pick<Execute, 'execute' | 'copyIn' | typeof Symbol.asyncDispose> & { cacheKey?: string }> = {};");
replace(task, `        if (this.compileCache?.[type]) {
            return {
                ...this.compileCache[type],
                clean: () => Promise.resolve(null),
            };
        }
`, '');
replace(task, "        span.setAttribute('lang', langId);", `        const rootfs = '/opt/hydrojudge/build-info/rootfs-path';
        const cacheKey = md5(JSON.stringify({
            schema: 1, version: require('../package.json').version,
            type, checkerType, langId, lang, env: getConfig('env'),
            toolchain: process.env.HYDROJUDGE_TOOLCHAIN_ID || (fs.existsSync(rootfs) ? fs.readFileSync(rootfs, 'utf8').trim() : ''),
        }));
        if (this.compileCache?.[type]?.cacheKey === cacheKey
            && Object.values(this.compileCache[type].copyIn).every((entry: any) => !entry.src || fs.existsSync(entry.src))) {
            span.setAttribute('cached', true);
            return { ...this.compileCache[type], clean: () => Promise.resolve(null) };
        }
        span.setAttribute('lang', langId);`);
replace(task, 'const loc = join(this.folder, `_${type}.cache`);', 'const loc = join(this.folder, `_${type}.${cacheKey}.cache`);');
replace(task, '            this.compileCache[type] = {\n                execute: result.execute,', '            this.compileCache[type] = {\n                cacheKey,\n                execute: result.execute,');
for (const [name, source] of Object.entries(sources)) fs.writeFileSync(path.join(root, 'src', name), source);
console.log('Patched HydroJudge 4.0.6 site lifecycle and versioned compiler cache');
