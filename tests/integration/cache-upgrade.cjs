'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const phase = process.argv[2];
assert.ok(['before', 'after'].includes(phase));
const root = '/var/cache/hydrojudge';
const dataSha256 = {};
let cachedPrograms = 0;
function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory()) visit(file);
    else if (entry.name === 'etags') {
      const etags = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const [name, program] of Object.entries(etags['*cache'] || {})) {
        cachedPrograms++;
        if (phase === 'before') assert.equal(program.cacheKey, undefined, 'Expected the released 0.1.0 cache format');
        else assert.match(program.cacheKey, /^[a-f0-9]{32}$/, `Unmigrated ${name} cache`);
        for (const input of Object.values(program.copyIn)) {
          if (input.src) assert.ok(fs.existsSync(input.src), 'Persisted executable must exist');
        }
      }
      for (const name of Object.keys(etags).filter((key) => key !== '*cache')) {
        const input = path.join(folder, name);
        dataSha256[path.relative(root, input)] = crypto.createHash('sha256').update(fs.readFileSync(input)).digest('hex');
      }
    }
  }
}
visit(root);
assert.ok(cachedPrograms >= 2, 'The upgrade fixture must include a checker and interactor');
console.log(JSON.stringify({ passed: true, phase, cachedPrograms, dataSha256 }, null, 2));
