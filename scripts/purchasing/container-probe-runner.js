'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

const SELF_BYTES_ENV = 'MINMAX_PROBE_PRINT_SELF_BYTES';

function spawnResult(spawn, command, args, options) {
  const result = spawn(command, args, {
    encoding: 'utf8',
    ...options,
    shell: false,
  });
  if (result.error) {
    throw result.error instanceof Error
      ? result.error
      : new Error(String(result.error));
  }
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with exit ${result.status}: ` +
      `${String(result.stderr || result.stdout || '').trim().slice(-4000)}`
    );
  }
  return result;
}

function runTrackedContainerProbe(options, dependencies = {}) {
  const spawn = dependencies.spawn || spawnSync;
  const sourceBytes = fs.readFileSync(options.hostPath);
  const beforeSpawnBytes = Buffer.from(sourceBytes);
  const baseEnvironment = {
    ...process.env,
    ...(options.environment || {}),
  };
  if (options.copy !== false) {
    spawnResult(
      spawn,
      'docker',
      ['cp', options.hostPath, `${options.container}:${options.containerPath}`],
      { env: baseEnvironment }
    );
  }

  const integrity = spawnResult(
    spawn,
    'docker',
    [
      'exec',
      '-e', SELF_BYTES_ENV,
      options.container,
      'node', options.containerPath,
    ],
    {
      env: { ...baseEnvironment, [SELF_BYTES_ENV]: '1' },
    }
  );
  const receivedBytes = Buffer.from(String(integrity.stdout || '').trim(), 'base64');
  if (!sourceBytes.equals(beforeSpawnBytes) || !sourceBytes.equals(receivedBytes)) {
    throw new Error(
      `Probe byte mismatch for ${options.containerPath}: ` +
      `source=${sourceBytes.length}, beforeSpawn=${beforeSpawnBytes.length}, ` +
      `received=${receivedBytes.length}.`
    );
  }

  const environmentNames = Object.keys(options.environment || {});
  const environmentArguments = environmentNames.flatMap(name => ['-e', name]);
  const execution = spawnResult(
    spawn,
    'docker',
    [
      'exec',
      ...environmentArguments,
      options.container,
      'node', options.containerPath,
    ],
    { env: baseEnvironment }
  );
  return {
    stdout: String(execution.stdout || '').trim(),
    stderr: String(execution.stderr || '').trim(),
    sourceBytes,
    beforeSpawnBytes,
    receivedBytes,
  };
}

function printSelfBytes(moduleObject) {
  if (process.env[SELF_BYTES_ENV] !== '1') return false;
  process.stdout.write(fs.readFileSync(moduleObject.filename).toString('base64'));
  return true;
}

module.exports = {
  SELF_BYTES_ENV,
  printSelfBytes,
  runTrackedContainerProbe,
};
