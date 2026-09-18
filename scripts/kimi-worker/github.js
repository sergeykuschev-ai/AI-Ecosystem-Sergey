'use strict';

const { execFile } = require('child_process');
const { scrub } = require('./logger');

// Thin, read-mostly wrapper around the GitHub CLI. Every call goes through
// runGh so output is uniformly redacted and errors carry context.
function runGh(args, { timeoutMs = 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile('gh', args, { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        const message = scrub(`gh ${args[0]} failed: ${(stderr || err.message).trim().split('\n').slice(0, 5).join(' | ')}`);
        reject(new Error(message));
        return;
      }
      resolve(scrub(stdout));
    });
  });
}

function ghJson(args, options) {
  return runGh([...args, '--json', options.fields.join(','), ...(options.extraArgs || [])], options)
    .then((out) => JSON.parse(out));
}

async function ensureLabel(repo, name, color, description) {
  await runGh(['label', 'create', name, '--repo', repo, '--color', color, '--description', description, '--force']);
}

async function listLabels(repo) {
  const out = await runGh(['label', 'list', '--repo', repo, '--limit', '200']);
  return out;
}

async function listEligibleIssues(repo, requiredLabel) {
  const fields = ['number', 'title', 'body', 'labels', 'state'];
  return ghJson(['issue', 'list', '--repo', repo, '--state', 'open', '--label', requiredLabel], { fields });
}

async function getIssue(repo, number) {
  const fields = ['number', 'title', 'body', 'labels', 'state'];
  const issue = (await ghJson(['issue', 'view', String(number), '--repo', repo], { fields }));
  return issue;
}

async function addLabel(repo, number, label) {
  await runGh(['issue', 'edit', String(number), '--repo', repo, '--add-label', label]);
}

async function removeLabel(repo, number, label) {
  await runGh(['issue', 'edit', String(number), '--repo', repo, '--remove-label', label]);
}

async function comment(repo, number, body) {
  await runGh(['issue', 'comment', String(number), '--repo', repo, '--body', body]);
}

async function findOpenPrForBranch(repo, branch) {
  const fields = ['number', 'url', 'state'];
  const prs = await ghJson(['pr', 'list', '--repo', repo, '--state', 'open', '--head', branch], { fields });
  return prs[0] || null;
}

async function createPr(repo, { branch, title, body }) {
  const url = await runGh([
    'pr', 'create', '--repo', repo,
    '--base', 'main',
    '--head', branch,
    '--title', title,
    '--body', body,
  ]);
  return url.trim();
}

module.exports = {
  runGh,
  ensureLabel,
  listLabels,
  listEligibleIssues,
  getIssue,
  addLabel,
  removeLabel,
  comment,
  findOpenPrForBranch,
  createPr,
};
