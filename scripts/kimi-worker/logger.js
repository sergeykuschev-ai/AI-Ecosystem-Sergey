'use strict';

const fs = require('fs');
const path = require('path');

const SCRUB_PATTERNS = [
  /gh[pousr]_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /sk-[A-Za-z0-9]{16,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
];

function scrub(text) {
  if (text === null || text === undefined) return String(text);
  let out = String(text);
  for (const re of SCRUB_PATTERNS) out = out.replace(re, '[REDACTED]');
  return out;
}

function createLogger(logsDir, name) {
  fs.mkdirSync(logsDir, { recursive: true });
  const filePath = path.join(
    logsDir,
    `${name}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  );
  const stream = fs.createWriteStream(filePath, { flags: 'a' });

  function write(level, args) {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(scrub).join(' ')}`;
    const target = level === 'ERROR' || level === 'WARN' ? process.stderr : process.stdout;
    target.write(line + '\n');
    stream.write(line + '\n');
  }

  return {
    path: filePath,
    info: (...args) => write('INFO', args),
    warn: (...args) => write('WARN', args),
    error: (...args) => write('ERROR', args),
    childStream: () => stream,
    close: () => stream.end(),
  };
}

module.exports = { createLogger, scrub };
