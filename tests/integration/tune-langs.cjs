'use strict';

const fs = require('node:fs');
const yaml = require('/opt/test-site/node_modules/js-yaml');

module.exports = async function tuneLanguages(Hydro) {
  const system = Hydro.model.system;
  const original = system.get('hydrooj.langs');
  const parsed = yaml.load(original);
  fs.writeFileSync('/qa/original-langs.yaml', original);
  parsed.c.compile_time_limit = 60000;
  parsed.cc.compile_time_limit = 60000;
  parsed.java.compile_time_limit = 120000;
  parsed['py.pypy3'].compile_time_limit = 60000;
  parsed.c.compile = parsed.c.compile.replace('/usr/bin/gcc', '/usr/bin/gcc -DQA_FROM_OJ=42');
  await system.set('hydrooj.langs', yaml.dump(parsed));
  return 'Set test-only compile limits (C/C++/PyPy 60s, Java 120s) and the C compiler flag';
};
