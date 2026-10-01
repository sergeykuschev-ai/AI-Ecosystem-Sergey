#!/usr/bin/env node
'use strict';

/**
 * Zero-dependency lint for apps/vozdooh-web:
 *  - syntax-check every .js file with `node --check`;
 *  - forbid `var` declarations and trailing whitespace;
 *  - forbid console.log outside scripts/ (library and test code stay quiet);
 *  - require a trailing newline at end of file.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['src', 'scripts', 'tests'];

/**
 * @param {string} dir
 * @returns {string[]}
 */
function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      out.push(...collectJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  /** @type {string[]} */
  const violations = [];

  const files = SCAN_DIRS.flatMap((dir) => {
    const full = path.join(ROOT, dir);
    return fs.existsSync(full) ? collectJsFiles(full) : [];
  }).sort();

  for (const file of files) {
    const rel = path.relative(ROOT, file);

    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (error) {
      const stderr = /** @type {{ stderr: Buffer }} */ (error).stderr.toString();
      violations.push(`${rel}: syntax error — ${stderr.trim()}`);
      continue;
    }

    const text = fs.readFileSync(file, 'utf8');
    const lines = text.split('\n');

    if (!text.endsWith('\n')) {
      violations.push(`${rel}: file must end with a newline`);
    }

    lines.forEach((line, index) => {
      const lineno = index + 1;
      if (/var\s+[A-Za-z_$]/.test(line)) {
        violations.push(`${rel}:${lineno}: "var" is forbidden — use const/let`);
      }
      if (/[ \t]+$/.test(line)) {
        violations.push(`${rel}:${lineno}: trailing whitespace`);
      }
      if (rel.startsWith('src') && /\bconsole\.log\(/.test(line)) {
        violations.push(`${rel}:${lineno}: console.log is not allowed in src/`);
      }
    });
  }

  if (violations.length > 0) {
    process.stderr.write(`lint: ${violations.length} violation(s)\n`);
    for (const violation of violations) {
      process.stderr.write(`  ${violation}\n`);
    }
    process.exit(1);
  }
  process.stdout.write(`lint: ok (${files.length} files checked)\n`);
}

main();
