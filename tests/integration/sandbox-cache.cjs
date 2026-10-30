'use strict';

// Exercise persisted JudgeTask caches through the real Linux sandbox/compiler.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const requireJudge = createRequire('/opt/hydrojudge/package.json');
requireJudge('@hydrooj/register');
const { JudgeTask } = requireJudge('@hydrooj/hydrojudge/src/task.ts');
const { getConfig } = requireJudge('@hydrooj/hydrojudge/src/config.ts');
const { runQueued } = requireJudge('@hydrooj/hydrojudge/src/sandbox.ts');

async function main() {
  const host = `_cache-regression-${process.pid}`;
  const root = path.join(getConfig('cache_dir'), host);
  const folder = path.join(root, 'system', '1');
  const previousToolchain = process.env.HYDROJUDGE_TOOLCHAIN_ID;
  const checks = [];
  let flag = 1;
  const session = { config: { host }, getLang: () => ({ key: 'c', code_file: 'foo.c', target: 'foo',
    compile: `/usr/bin/gcc -DREVIEW_VERSION=${flag} -o foo foo.c`, execute: './foo' }) };
  fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'cached.c'), '#include <stdio.h>\nint main(void){printf("%d\\n",REVIEW_VERSION);}\n');
  fs.writeFileSync(path.join(folder, 'etags'), JSON.stringify({ 'cached.c': 'unchanged-etag' }));
  async function compileAndRun() {
    const task = new JudgeTask(session, {});
    task.config = { user_extra_files: [], judge_extra_files: [] };
    task.next = () => {};
    task.folder = await task.cacheOpen('system/1', [{ name: 'cached.c', etag: 'unchanged-', lastModified: 'etag' }]);
    try {
      const executable = await task.compileLocalFile('std', 'cached.c');
      const output = await runQueued(executable.execute, { copyIn: executable.copyIn, time: 2000, memory: 64 });
      assert.equal(output.status, 1);
      assert.equal(output.stdout.trim(), String(flag));
      await output[Symbol.asyncDispose]();
      const cached = task.compileCache.std;
      return { key: cached.cacheKey, artifact: cached.copyIn.foo.src, hit: Boolean(executable.copyIn.foo.src) };
    } finally {
      for (const clean of task.clean) await clean();
      task.span.end();
    }
  }
  try {
    const initial = await compileAndRun();
    assert.match(initial.key, /^[a-f0-9]{32}$/);
    const warm = await compileAndRun();
    assert.equal(warm.hit, true, 'An unchanged compiler configuration should reuse the disk cache');
    assert.equal(warm.key, initial.key);
    checks.push('unchanged configuration reuses persisted cache');
    flag = 2;
    const changed = await compileAndRun();
    assert.equal(changed.hit, false);
    assert.notEqual(changed.key, initial.key);
    assert.notEqual(changed.artifact, initial.artifact);
    assert.equal(fs.existsSync(initial.artifact), true, 'A compiler update must not overwrite another task artifact');
    checks.push('compiler flags invalidate cache and preserve old in-flight artifacts');
    process.env.HYDROJUDGE_TOOLCHAIN_ID = 'isolated-toolchain-change';
    const toolchain = await compileAndRun();
    assert.equal(toolchain.hit, false);
    assert.notEqual(toolchain.key, changed.key);
    checks.push('toolchain identity invalidates cache');
    const etags = JSON.parse(fs.readFileSync(path.join(folder, 'etags'), 'utf8'));
    delete etags['*cache'].std.cacheKey;
    fs.writeFileSync(path.join(folder, 'etags'), JSON.stringify(etags));
    assert.equal((await compileAndRun()).hit, false, 'Legacy caches must be recompiled on upgrade');
    checks.push('legacy metadata is migrated by recompiling');
    fs.unlinkSync(toolchain.artifact);
    assert.equal((await compileAndRun()).hit, false, 'Missing cached programs must be rebuilt');
    checks.push('missing artifacts are rebuilt');
    console.log(JSON.stringify({ passed: true, checks }, null, 2));
  } finally {
    if (previousToolchain === undefined) delete process.env.HYDROJUDGE_TOOLCHAIN_ID;
    else process.env.HYDROJUDGE_TOOLCHAIN_ID = previousToolchain;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
