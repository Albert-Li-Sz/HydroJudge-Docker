'use strict';

async function checkSandbox() {
  const get = async (endpoint) => {
    const response = await fetch(`http://127.0.0.1:5050/${endpoint}`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!response.ok) throw new Error(`Sandbox ${endpoint}: HTTP ${response.status}`);
    return response.json();
  };
  const [version, config] = await Promise.all([get('version'), get('config')]);
  if (!version.buildVersion || !config.fixSymlinkEscape) {
    throw new Error('Sandbox version or required symlink protection is missing');
  }
  const runner = config.runnerConfig;
  if (runner?.seccomp !== true) {
    throw new Error('Sandbox seccomp is disabled');
  }
  if (![1, 2].includes(runner?.cgroupType)) {
    throw new Error('Sandbox cgroup unavailable; check privileged mode and the host cgroup configuration');
  }
  const controllers = runner.cgroupControllers;
  if (!Array.isArray(controllers) || !controllers.includes('memory') || !controllers.includes('pids')
      || !(controllers.includes('cpu') || controllers.includes('cpuacct'))) {
    throw new Error('Sandbox CPU accounting, memory or pids cgroup controller is missing');
  }
  return version;
}

module.exports = checkSandbox;
if (require.main === module) {
  checkSandbox().then((version) => console.log(`[sandbox] Ready: ${version.buildVersion}`)).catch((error) => {
    console.error(`[sandbox] ${error.message}`);
    process.exitCode = 1;
  });
}
