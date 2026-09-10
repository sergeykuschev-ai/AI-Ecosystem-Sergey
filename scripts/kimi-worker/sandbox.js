'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

// macOS Seatbelt (sandbox-exec) profile that isolates Kimi DURING execution,
// not just after it. Verified on macOS 26 (see tests/safety.test.js):
//   - writes are impossible outside the task worktree, /private/tmp,
//     ~/.kimi-code (Kimi session state) and /dev;
//   - reads of ~/.ssh, ~/.aws, ~/.gnupg, ~/.config, ~/Library, ~/Documents
//     (main clone + all other repos/worktrees) and the worker admin dir are
//     denied, including through symlinks;
//   - sibling task worktrees cannot be listed or read;
//   - credential tooling (security/ssh/gh/gpg/sudo/launchctl) cannot exec.
//
// macOS quirks encoded here (do not simplify blindly):
//   - firmlinks: every protected path is embedded BOTH as the /Users/...
//     form and its realpath (/System/Volumes/Data/...); seatbelt matches
//     some operations on the literal path string (e.g. kqueue watch);
//   - writes use deny-with-require-not exceptions because a plain
//     (allow file-write*) never overrides a matching (deny ...);
//   - sibling isolation denies file-read-DATA on the shared worktrees dir
//     while allowing file-read-DATA on the chain ancestors; metadata stays
//     allowed everywhere so getcwd/open traversal keeps working.

function bothForms(p) {
  try {
    const real = fs.realpathSync(p);
    return real === p ? [p] : [p, real];
  } catch {
    return [p];
  }
}

function isAvailable() {
  try {
    fs.accessSync('/usr/bin/sandbox-exec', fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function buildProfile(worktreePath) {
  // Ancestor dirs must exist for realpath resolution.
  fs.mkdirSync(config.worktreesDir, { recursive: true });
  fs.mkdirSync(config.adminHome, { recursive: true });
  const wt = bothForms(worktreePath);
  const wtNot = wt.map((p) => `(require-not (subpath "${p}"))`).join(' ');
  const worktreesReal = fs.realpathSync(config.worktreesDir);
  const workerHomeReal = fs.realpathSync(config.workerHome);
  const kimiHome = path.join(process.env.HOME || '', '.kimi-code');
  const writeExceptions = [...wt, '/private/tmp', kimiHome, '/dev']
    .map((p) => `(require-not (subpath "${p}"))`)
    .join(' ');
  const readDeny = config.sandbox.readDenySubpaths
    .flatMap(bothForms)
    .map((p) => `(subpath "${p}")`)
    .join(' ');
  const execDeny = config.sandbox.execDenyBinaries
    .map((p) => `(literal "${p}")`)
    .join(' ');
  const wtReadAllow = wt.map((p) => `(subpath "${p}")`).join(' ');

  return `(version 1)
(allow default)
(deny file-write* (require-all (subpath "/") ${writeExceptions}))
(deny file-read* ${readDeny})
(allow file-read-data (literal "${workerHomeReal}") (literal "${worktreesReal}") ${wtReadAllow})
(deny file-read-data (require-all (subpath "${worktreesReal}") ${wtNot}))
(deny file-read-data (subpath "${fs.realpathSync(config.adminHome)}"))
(deny process-exec* ${execDeny})
`;
}

function writeProfile(worktreePath) {
  const dir = config.sandboxDir;
  fs.mkdirSync(dir, { recursive: true });
  const profilePath = path.join(dir, `kimi-${process.pid}.sb`);
  fs.writeFileSync(profilePath, buildProfile(worktreePath));
  return profilePath;
}

// Wraps a command so it runs under the seatbelt profile for this worktree.
function wrap(worktreePath, command, args) {
  const profilePath = writeProfile(worktreePath);
  return {
    command: '/usr/bin/sandbox-exec',
    args: ['-f', profilePath, command, ...args],
    profilePath,
  };
}

module.exports = { isAvailable, buildProfile, wrap };
