'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');

function slugify(text) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'task';
}

function branchNameForIssue(issue) {
  return `${config.branchPrefix}${issue.number}-${slugify(issue.title)}`;
}

function assertSafeBranchName(branch) {
  if (!/^ai\/kimi-\d+-[a-z0-9а-яё-]+$/.test(branch)) {
    throw new Error(`Refusing to operate on branch name outside policy: ${branch}`);
  }
}

function isForbiddenPath(file) {
  return config.forbiddenPathPatterns.some((re) => re.test(file));
}

// Parses raw `git status --porcelain=v1` output into repo-relative paths.
// Each line is exactly "XY PATH": two status chars, one separator space, then
// the path at index 3. The first status char is a SPACE for unstaged changes
// (" M path"), so the output must NEVER be trim()ed before parsing — trimming
// shifts the path one char left and slice(3) silently drops its first letter
// ("apps/..." became "pps/...", which then failed the area policy; real run,
// issue #37 follow-up). Rename/copy lines ("R  old -> new") yield the new path.
function parsePorcelainPaths(statusOut) {
  const paths = [];
  for (const line of String(statusOut || '').split('\n')) {
    if (line.length <= 3) continue;
    let p = line.slice(3);
    const arrow = p.lastIndexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    paths.push(p);
  }
  return paths;
}

// Every changed file must live inside the area's allowed paths and must not
// match a forbidden pattern. Paths are normalized first so a repo-relative
// "apps/stores-web/../../escape" cannot smuggle a traversal past the prefix
// check (belt and braces: git already normalizes, the sandbox blocks writes
// outside the worktree anyway).
function validateChangedFiles(files, area) {
  const violations = [];
  for (const raw of files) {
    const file = path.posix.normalize(raw);
    const allowedExactPaths = area.allowedExactPaths || [];
    // Exact exceptions are intentionally narrow and must already be normalized.
    // This prevents traversal-shaped input from normalizing into an exception.
    const exactAllowed = raw === file && allowedExactPaths.includes(file);
    if (isForbiddenPath(file) && !exactAllowed) {
      violations.push(`${raw}: forbidden path pattern`);
      continue;
    }
    const allowed = exactAllowed || area.allowedPaths.some((prefix) => file.startsWith(prefix));
    if (!allowed) {
      const locations = [...area.allowedPaths, ...allowedExactPaths];
      violations.push(`${raw}: outside allowed paths [${locations.join(', ')}]`);
    }
  }
  return violations;
}

function looksBinary(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  return sample.includes(0);
}

// Symlinks are rejected outright in V1: a symlink inside the allowed area can
// point outside it, and both the secret scan and the area validation must
// never follow it.
function findSymlinkViolations(worktreePath, files) {
  const violations = [];
  for (const file of files) {
    const full = path.join(worktreePath, file);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      violations.push(`${file}: symlinks are not allowed`);
    }
  }
  return violations;
}

// Scan staged file contents for secret-shaped strings. Uses lstat and refuses
// symlinks; skips binary and oversized files.
function scanFilesForSecrets(worktreePath, files) {
  const findings = [];
  for (const file of files) {
    const full = path.join(worktreePath, file);
    let stat;
    try {
      stat = fs.lstatSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) {
      findings.push(`${file}: symlink refused by secret scan`);
      continue;
    }
    if (!stat.isFile() || stat.size > config.secretScanMaxFileBytes) continue;
    const buffer = fs.readFileSync(full);
    if (looksBinary(buffer)) continue;
    const text = buffer.toString('utf8');
    for (const { name, re } of config.secretPatterns) {
      const match = text.match(re);
      if (match) {
        findings.push(`${file}: matches secret pattern "${name}"`);
        break;
      }
    }
  }
  return findings;
}

module.exports = {
  slugify,
  branchNameForIssue,
  assertSafeBranchName,
  validateChangedFiles,
  parsePorcelainPaths,
  findSymlinkViolations,
  scanFilesForSecrets,
  isForbiddenPath,
};
