'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Preserve the requested OLE verdict policy while keeping HydroJudge 4.0.6's
// upstream file-based stdout/stderr collectors and memory accounting.
// Fail closed if the upstream implementation changes.
const root = process.argv[2] || path.join(process.cwd(), 'node_modules', '@hydrooj', 'hydrojudge');
const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (metadata.version !== '4.0.6') throw new Error(`Review the output-limit patch for HydroJudge ${metadata.version}`);
const file = path.join(root, 'src', 'sandbox.ts');
let source = fs.readFileSync(file, 'utf8');
function replaceOnce(previous, replacement, label) {
  if (source.split(previous).length !== 2) throw new Error(`HydroJudge ${label} does not match the expected version`);
  source = source.replace(previous, replacement);
}
replaceOnce(
  '[SandboxStatus.OutputLimitExceeded, STATUS.STATUS_RUNTIME_ERROR]',
  '[SandboxStatus.OutputLimitExceeded, STATUS.STATUS_OUTPUT_LIMIT_EXCEEDED]',
  'output-limit mapping',
);
const marker = "    ret.stdout = ret.files[outname] || '';";
replaceOnce(marker, `    // Preserve an explicit sandbox OLE even when copying the output file failed.
    // Give recorded standard-stream overflow OLE priority over later TLE/MLE.
    if (result.status === SandboxStatus.OutputLimitExceeded
        || result.fileError?.some((error) => ['stdout', 'stderr'].includes(error.name)
        && error.type === 'CollectSizeExceeded')) {
        ret.status = STATUS.STATUS_OUTPUT_LIMIT_EXCEEDED;
    }
${marker}`, 'collector status handling');
fs.writeFileSync(file, source);
console.log('Patched HydroJudge 4.0.6 output-limit status; upstream collectors retained');
