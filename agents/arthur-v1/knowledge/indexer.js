'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EXCLUDED_PATTERNS = [
  /node_modules/,
  /\.git/,
  /output\//,
  /tmp\//,
  /\.tmp$/,
  /\.backup$/,
  /\.bak$/,
  /\.log$/,
  /owner-decision-history\.json$/,
  /miska-owner-decisions\.json$/,
  /raw-/,
  /upload\.tmp/,
];

const INCLUDED_EXTENSIONS = Object.freeze(['.md', '.json']);

function isExcluded(filePath) {
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(filePath));
}

function hasIncludedExtension(filePath) {
  return INCLUDED_EXTENSIONS.includes(path.extname(filePath).toLowerCase());
}

function classifyDocument(filePath, relativePath) {
  const basename = path.basename(filePath);
  if (basename.includes('matrix')) return 'matrix';
  if (basename.includes('policy')) return 'rule';
  if (basename.includes('config')) return 'config';
  if (basename.includes('financial')) return 'reference';
  if (basename.includes('adr') || basename.includes('architecture')) return 'adr';
  if (basename.includes('decision')) return 'decision';
  if (basename.includes('instruction') || basename.includes('guide')) return 'instruction';
  if (path.extname(filePath) === '.md') return 'documentation';
  return 'reference';
}

function readContent(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');
  if (ext === '.json') {
    try {
      const parsed = JSON.parse(raw);
      return JSON.stringify(parsed, null, 2).slice(0, 5000);
    } catch {
      return raw.slice(0, 5000);
    }
  }
  return raw.slice(0, 10000);
}

function indexDirectory(rootPath, index, relativePrefix = '') {
  if (!fs.existsSync(rootPath)) return;
  const entries = fs.readdirSync(rootPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(rootPath, entry.name);
    const relativePath = path.join(relativePrefix, entry.name);

    if (isExcluded(fullPath) || isExcluded(relativePath)) continue;

    if (entry.isDirectory()) {
      indexDirectory(fullPath, index, relativePath);
    } else if (entry.isFile() && hasIncludedExtension(fullPath)) {
      const id = relativePath.replace(/\\/g, '/');
      index.set(id, {
        id,
        type: classifyDocument(fullPath, relativePath),
        title: entry.name,
        content: readContent(fullPath),
        source: fullPath,
        updatedAt: fs.statSync(fullPath).mtime.toISOString(),
      });
    }
  }
}

function indexFiles(filePaths) {
  const index = new Map();
  for (const filePath of filePaths) {
    if (!fs.existsSync(filePath) || isExcluded(filePath)) continue;
    const id = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
    index.set(id, {
      id,
      type: classifyDocument(filePath, id),
      title: path.basename(filePath),
      content: readContent(filePath),
      source: filePath,
      updatedAt: fs.statSync(filePath).mtime.toISOString(),
    });
  }
  return index;
}

module.exports = {
  isExcluded,
  hasIncludedExtension,
  classifyDocument,
  readContent,
  indexDirectory,
  indexFiles,
  EXCLUDED_PATTERNS,
};
