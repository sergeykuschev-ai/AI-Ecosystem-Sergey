const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_STALE_MAX_AGE_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BACKUPS = 5;
const DEFAULT_JSON_INDENT = 2;

class SafeJsonStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'SafeJsonStoreError';
    this.code = code;
  }
}

function serializeJson(data, indent = DEFAULT_JSON_INDENT) {
  return `${JSON.stringify(data, null, indent)}\n`;
}

function fsyncDirectory(directoryPath, fsModule = fs) {
  let descriptor;
  try {
    descriptor = fsModule.openSync(directoryPath, 'r');
    fsModule.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fsModule.closeSync(descriptor);
  }
}

function parseGlobPattern(pattern) {
  if (pattern instanceof RegExp) return pattern;
  if (typeof pattern !== 'string') {
    throw new SafeJsonStoreError(
      'SAFE_JSON_INVALID_PATTERN',
      'Шаблон для очистки временных файлов должен быть строкой или RegExp.'
    );
  }
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`);
}

function cleanStaleTemporaryFiles(directory, pattern, maxAgeMs, fsModule = fs) {
  const resolvedDirectory = path.resolve(directory);
  const regex = parseGlobPattern(pattern);
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;
  let errors = 0;
  let skipped = 0;

  let entries;
  try {
    entries = fsModule.readdirSync(resolvedDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return { removed: 0, errors: 0, skipped: 0 };
    throw new SafeJsonStoreError(
      'SAFE_JSON_CLEAN_FAILED',
      `Не удалось прочитать директорию «${resolvedDirectory}» для очистки: ${error.message}.`,
      { cause: error }
    );
  }

  for (const name of entries) {
    if (!regex.test(name)) continue;
    const filePath = path.join(resolvedDirectory, name);
    try {
      const stat = fsModule.statSync(filePath);
      if (!stat.isFile()) {
        skipped += 1;
        continue;
      }
      if (stat.mtimeMs < cutoff) {
        fsModule.unlinkSync(filePath);
        removed += 1;
      }
    } catch {
      errors += 1;
    }
  }
  return { removed, errors, skipped };
}

function atomicWriteJsonFile(filePath, data, options = {}) {
  const fsModule = options.fsModule || fs;
  const resolvedPath = path.resolve(filePath);
  const directoryPath = path.dirname(resolvedPath);
  const baseName = path.basename(resolvedPath);
  const suffix = options.randomSuffix || crypto.randomBytes(6).toString('hex');
  const temporaryPath = path.join(
    directoryPath,
    `.${baseName}.${process.pid}-${suffix}.tmp`
  );

  let descriptor;
  try {
    fsModule.mkdirSync(directoryPath, { recursive: true });
    const content = serializeJson(data, options.indent ?? DEFAULT_JSON_INDENT);
    descriptor = fsModule.openSync(temporaryPath, 'wx', 0o600);
    fsModule.writeFileSync(descriptor, content, 'utf8');
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    fsModule.renameSync(temporaryPath, resolvedPath);
    fsyncDirectory(directoryPath, fsModule);
    const staleMaxAgeMs = options.staleMaxAgeMs ?? DEFAULT_STALE_MAX_AGE_MS;
    cleanStaleTemporaryFiles(
      directoryPath,
      `.${baseName}.*.tmp`,
      staleMaxAgeMs,
      fsModule
    );
    return { filePath: resolvedPath, temporaryPath };
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        fsModule.closeSync(descriptor);
      } catch {}
    }
    try {
      if (fsModule.existsSync(temporaryPath)) {
        fsModule.unlinkSync(temporaryPath);
      }
    } catch {}
    throw new SafeJsonStoreError(
      'SAFE_JSON_WRITE_FAILED',
      `Не удалось атомарно записать JSON-файл «${resolvedPath}»: ${error.message}.`,
      { cause: error }
    );
  }
}

function listBackups(filePath, fsModule = fs) {
  const resolvedPath = path.resolve(filePath);
  const directoryPath = path.dirname(resolvedPath);
  const baseName = path.basename(resolvedPath);
  const prefix = `.${baseName}.backup.`;
  try {
    return fsModule.readdirSync(directoryPath)
      .filter(name => name.startsWith(prefix) && name.endsWith('.json'))
      .map(name => {
        const backupPath = path.join(directoryPath, name);
        try {
          return {
            name,
            path: backupPath,
            mtime: fsModule.statSync(backupPath).mtimeMs,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((left, right) => right.mtime - left.mtime);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

function rotateBackup(filePath, options = {}) {
  const fsModule = options.fsModule || fs;
  const resolvedPath = path.resolve(filePath);
  if (!fsModule.existsSync(resolvedPath)) {
    return { backedUp: false, backupPath: null, removed: [] };
  }

  const directoryPath = path.dirname(resolvedPath);
  const baseName = path.basename(resolvedPath);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  let backupPath = path.join(
    directoryPath,
    `.${baseName}.backup.${timestamp}.json`
  );
  let counter = 1;
  while (fsModule.existsSync(backupPath)) {
    backupPath = path.join(
      directoryPath,
      `.${baseName}.backup.${timestamp}-${counter}.json`
    );
    counter += 1;
  }

  fsModule.copyFileSync(resolvedPath, backupPath);

  const maxBackups = options.maxBackups ?? DEFAULT_MAX_BACKUPS;
  const backups = listBackups(resolvedPath, fsModule);
  const removed = [];
  for (const backup of backups.slice(maxBackups)) {
    try {
      fsModule.unlinkSync(backup.path);
      removed.push(backup.path);
    } catch {}
  }

  return { backedUp: true, backupPath, removed };
}

function readJsonFileWithRecovery(filePath, options = {}) {
  const fsModule = options.fsModule || fs;
  const resolvedPath = path.resolve(filePath);

  let source;
  try {
    source = fsModule.readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new SafeJsonStoreError(
        'SAFE_JSON_NOT_FOUND',
        `JSON-файл не найден: ${resolvedPath}.`,
        { cause: error }
      );
    }
    throw new SafeJsonStoreError(
      'SAFE_JSON_READ_FAILED',
      `Не удалось прочитать JSON-файл «${resolvedPath}»: ${error.message}.`,
      { cause: error }
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (parseError) {
    const backups = listBackups(resolvedPath, fsModule);
    for (const backup of backups) {
      try {
        const backupSource = fsModule.readFileSync(backup.path, 'utf8');
        const backupData = JSON.parse(backupSource);
        return {
          data: backupData,
          sourcePath: resolvedPath,
          recoveredFrom: backup.path,
          diagnostic: {
            code: 'SAFE_JSON_RECOVERED_FROM_BACKUP',
            message: `Основной файл повреждён; восстановлено из резервной копии ${backup.name}.`,
            cause: parseError.message,
          },
        };
      } catch {
        // Пробуем следующую резервную копию.
      }
    }

    throw new SafeJsonStoreError(
      'SAFE_JSON_CORRUPTED',
      `JSON-файл «${resolvedPath}» повреждён и нет доступной резервной копии.`,
      { cause: parseError }
    );
  }

  return {
    data: parsed,
    sourcePath: resolvedPath,
    recoveredFrom: null,
    diagnostic: null,
  };
}

module.exports = {
  DEFAULT_MAX_BACKUPS,
  DEFAULT_STALE_MAX_AGE_MS,
  SafeJsonStoreError,
  atomicWriteJsonFile,
  cleanStaleTemporaryFiles,
  fsyncDirectory,
  readJsonFileWithRecovery,
  rotateBackup,
  serializeJson,
};
