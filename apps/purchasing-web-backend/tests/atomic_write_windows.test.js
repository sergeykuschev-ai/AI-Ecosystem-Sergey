'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { afterEach, test } = require('node:test');

const {
  atomicWriteFile,
} = require('../storage/file_artifact_store');

const temporaryRoots = [];

function temporaryRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-'));
  temporaryRoots.push(root);
  return root;
}

function temporaryFiles(root) {
  return fs.readdirSync(root, { recursive: true })
    .filter(name => name.endsWith('.tmp'));
}

function filesystemWithRenameFailures(failures) {
  let renameCalls = 0;
  return {
    module: new Proxy(fs, {
      get(target, property) {
        if (property !== 'renameSync') return target[property];
        return (source, destination) => {
          const code = failures[renameCalls];
          renameCalls += 1;
          if (code) {
            throw Object.assign(
              new Error(`${code}: simulated Windows rename failure`),
              { code, syscall: 'rename', path: source, dest: destination }
            );
          }
          return target.renameSync(source, destination);
        };
      },
    }),
    renameCalls() {
      return renameCalls;
    },
  };
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true });
  }
});

test('atomic write creates, replaces, and sequentially updates a registry', () => {
  const root = temporaryRoot();
  const filePath = path.join(root, 'upload-idempotency.json');

  atomicWriteFile(filePath, '{"sequence":1}');
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
    sequence: 1,
  });

  for (let sequence = 2; sequence <= 5; sequence += 1) {
    atomicWriteFile(filePath, JSON.stringify({ sequence }));
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
    sequence: 5,
  });
  assert.deepEqual(temporaryFiles(root), []);
});

for (const code of ['EPERM', 'EEXIST']) {
  test(`Windows replace retries transient ${code} without deleting destination`, () => {
    const root = temporaryRoot();
    const filePath = path.join(root, 'upload-idempotency.json');
    fs.writeFileSync(filePath, '{"sequence":1}', 'utf8');
    const windowsFs = filesystemWithRenameFailures([code]);
    const waits = [];

    atomicWriteFile(filePath, '{"sequence":2}', {
      fsModule: windowsFs.module,
      platform: 'win32',
      sleep(delayMs) { waits.push(delayMs); },
    });

    assert.equal(windowsFs.renameCalls(), 2);
    assert.deepEqual(waits, [20]);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
      sequence: 2,
    });
    assert.deepEqual(temporaryFiles(root), []);
  });
}

test('exhausted Windows rename retries preserve destination and clean temp', () => {
  const root = temporaryRoot();
  const filePath = path.join(root, 'upload-idempotency.json');
  fs.writeFileSync(filePath, '{"sequence":1}', 'utf8');
  const windowsFs = filesystemWithRenameFailures([
    'EPERM',
    'EPERM',
    'EPERM',
  ]);

  assert.throws(
    () => atomicWriteFile(filePath, '{"sequence":2}', {
      fsModule: windowsFs.module,
      platform: 'win32',
      renameAttempts: 3,
      renameRetryDelayMs: 0,
      sleep() {},
    }),
    error => error.code === 'EPERM' && error.syscall === 'rename'
  );
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
    sequence: 1,
  });
  assert.deepEqual(temporaryFiles(root), []);
});

test('Windows skips unsupported directory fsync after committed rename', () => {
  const root = temporaryRoot();
  const filePath = path.join(root, 'upload-idempotency.json');
  let directoryOpenCalls = 0;
  const windowsFs = new Proxy(fs, {
    get(target, property) {
      if (property !== 'openSync') return target[property];
      return (targetPath, ...args) => {
        if (targetPath === root) {
          directoryOpenCalls += 1;
          throw Object.assign(
            new Error('EPERM: operation not permitted, open directory'),
            { code: 'EPERM', syscall: 'open', path: root }
          );
        }
        return target.openSync(targetPath, ...args);
      };
    },
  });

  assert.doesNotThrow(() => atomicWriteFile(filePath, '{"saved":true}', {
    fsModule: windowsFs,
    platform: 'win32',
  }));
  assert.equal(directoryOpenCalls, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
    saved: true,
  });
  assert.deepEqual(temporaryFiles(root), []);
});

test('directory fsync EPERM cannot turn a committed write into failure', () => {
  const root = temporaryRoot();
  const filePath = path.join(root, 'upload-idempotency.json');
  let directoryDescriptor;
  const fsWithUnsupportedDirectoryFsync = new Proxy(fs, {
    get(target, property) {
      if (property === 'openSync') {
        return (targetPath, ...args) => {
          const descriptor = target.openSync(targetPath, ...args);
          if (targetPath === root) directoryDescriptor = descriptor;
          return descriptor;
        };
      }
      if (property === 'fsyncSync') {
        return descriptor => {
          if (descriptor === directoryDescriptor) {
            throw Object.assign(
              new Error('EPERM: operation not permitted, fsync'),
              { code: 'EPERM', syscall: 'fsync' }
            );
          }
          return target.fsyncSync(descriptor);
        };
      }
      return target[property];
    },
  });

  assert.doesNotThrow(() => atomicWriteFile(filePath, '{"saved":true}', {
    fsModule: fsWithUnsupportedDirectoryFsync,
    platform: 'linux',
  }));
  assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), {
    saved: true,
  });
  assert.deepEqual(temporaryFiles(root), []);
});
