'use strict';

const fs = require('node:fs');

module.exports = async function addMissingFixtures(Hydro) {
  const fixtures = JSON.parse(fs.readFileSync('/qa/fixtures.json', 'utf8'));
  const manifest = JSON.parse(fs.readFileSync('/qa/manifest.json', 'utf8'));
  let added = 0;
  for (const fixture of fixtures) {
    if (manifest[fixture.key]) continue;
    const pid = await Hydro.model.problem.add('system', fixture.key.toUpperCase(), fixture.key, 'Local judge validation', 2);
    for (const [name, content] of Object.entries(fixture.files)) {
      await Hydro.model.problem.addTestdata('system', pid, name, Buffer.from(content), 2);
    }
    manifest[fixture.key] = pid;
    added++;
  }
  fs.writeFileSync('/qa/manifest.json', JSON.stringify(manifest, null, 2));
  return { added };
};
