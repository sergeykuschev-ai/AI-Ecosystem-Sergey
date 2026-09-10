'use strict';

const fs = require('fs');
const path = require('path');

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// Advisory lock: one worker per lock path. Stale locks left by a dead PID
// are reclaimed. Never touches the repository itself.
function acquire(lockPath) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  if (fs.existsSync(lockPath)) {
    let existing;
    try {
      existing = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    } catch (err) {
      throw new Error(`Lock file ${lockPath} is unreadable: ${err.message}. Refusing to guess.`);
    }
    if (pidAlive(existing.pid)) {
      return null;
    }
  }
  const tmpPath = `${lockPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }));
  fs.renameSync(tmpPath, lockPath);
  return () => release(lockPath);
}

function release(lockPath) {
  try {
    fs.unlinkSync(lockPath);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
}

module.exports = { acquire };
