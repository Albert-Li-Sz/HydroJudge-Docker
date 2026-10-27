'use strict';

const assert = require('node:assert/strict');
const address = 'http://127.0.0.1:5050';

async function run(args, copyIn = {}, copyOutCached = [], stdin = '') {
  const response = await fetch(`${address}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: [{ args, copyIn, copyOutCached,
      env: ['PATH=/usr/local/bin:/usr/bin:/bin', 'HOME=/w', 'LANG=C.UTF-8'],
      files: [{ content: stdin }, { name: 'stdout', max: 8192 }, { name: 'stderr', max: 8192 }],
      cpuLimit: 30000000000, clockLimit: 90000000000, memoryLimit: 1073741824, procLimit: 128,
    }] }),
    signal: AbortSignal.timeout(120000),
  });
  assert.equal(response.ok, true, `sandbox HTTP ${response.status}`);
  const [result] = await response.json();
  assert.equal(result.status, 'Accepted', JSON.stringify(result));
  return result;
}

async function main() {
  for (const [name, source, compiler] of [
    ['C', '#include <stdio.h>\nint main(){int a,b;scanf("%d%d",&a,&b);printf("%d\\n",a+b);}', '/usr/bin/gcc'],
    ['C++', '#include <bits/stdc++.h>\nusing namespace std;int main(){int a,b;cin>>a>>b;cout<<a+b<<"\\n";}', '/usr/bin/g++'],
  ]) {
    const file = name === 'C' ? 'foo.c' : 'foo.cc';
    const compiled = await run([compiler, '-O2', '-o', 'foo', file], { [file]: { content: source } }, ['foo']);
    assert.ok(compiled.fileIds?.foo, `${name} compiler did not produce an executable`);
    try {
      const result = await run(['/w/foo'], { foo: { fileId: compiled.fileIds.foo } }, [], '1 2\n');
      assert.equal(result.files.stdout.trim(), '3', `${name} output`);
    } finally {
      await fetch(`${address}/file/${encodeURIComponent(compiled.fileIds.foo)}`, { method: 'DELETE' });
    }
    console.log(`${name}: compiled and ran successfully`);
  }
  const python = await run(['/usr/bin/python3', '/w/foo.py'], {
    'foo.py': { content: 'import platform\nassert platform.python_implementation()=="CPython"\na,b=map(int,input().split());print(a+b)\n' },
  }, [], '1 2\n');
  assert.equal(python.files.stdout.trim(), '3', 'Python output');
  console.log('Python: executed successfully');
  const pypy = await run(['/usr/bin/pypy3', '/w/foo.py'], {
    'foo.py': { content: 'import platform,sys\nassert platform.python_implementation()=="PyPy"\nassert sys.pypy_translation_info["translation.jit"]\na,b=map(int,input().split());print(a+b)\n' },
  }, [], '1 2\n');
  assert.equal(pypy.files.stdout.trim(), '3', 'PyPy output');
  console.log('PyPy3: executed successfully');
  const java = await run(['/bin/bash', '-c', 'javac -d /w -encoding UTF-8 Main.java && jar cf Main.jar *.class'], {
    'Main.java': { content: 'import java.util.Scanner; public class Main { public static void main(String[] args) { if(Runtime.version().feature()!=21)throw new AssertionError("Java 21 required"); Scanner s=new Scanner(System.in);System.out.println(s.nextLong()+s.nextLong());}}' },
  }, ['Main.jar']);
  assert.ok(java.fileIds?.['Main.jar'], 'Java compiler did not produce a JAR');
  try {
    const result = await run(['/usr/bin/java', '-cp', 'Main.jar', 'Main'], {
      'Main.jar': { fileId: java.fileIds['Main.jar'] },
    }, [], '1 2\n');
    assert.equal(result.files.stdout.trim(), '3', 'Java output');
  } finally {
    await fetch(`${address}/file/${encodeURIComponent(java.fileIds['Main.jar'])}`, { method: 'DELETE' });
  }
  console.log('Java21: compiled, packaged and ran successfully');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
