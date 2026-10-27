'use strict';

const fs = require('node:fs');

module.exports = async function seed(Hydro) {
  const { user, problem, system } = Hydro.model;
  const credentials = JSON.parse(fs.readFileSync('/qa/credentials.json', 'utf8'));
  await user.create('admin@hydro-validation.invalid', 'qa-admin', credentials.admin, 2);
  await user.setSuperAdmin(2);
  await user.create('judge@hydro-validation.invalid', 'qa-judge', credentials.judge, 3);
  await user.setJudge(3);
  await system.set('server.host', '0.0.0.0');
  await system.set('server.port', 8888);
  await system.set('server.url', 'http://site:8888/');
  const fixtures = JSON.parse(fs.readFileSync('/qa/fixtures.json', 'utf8'));
  const manifest = {};
  for (const fixture of fixtures) {
    const pid = await problem.add('system', fixture.key.toUpperCase(), fixture.key, 'Local judge validation', 2);
    for (const [name, content] of Object.entries(fixture.files)) {
      await problem.addTestdata('system', pid, name, Buffer.from(content), 2);
    }
    manifest[fixture.key] = pid;
  }
  fs.writeFileSync('/qa/manifest.json', JSON.stringify(manifest, null, 2));
  return { seededProblems: Object.keys(manifest).length };
};
