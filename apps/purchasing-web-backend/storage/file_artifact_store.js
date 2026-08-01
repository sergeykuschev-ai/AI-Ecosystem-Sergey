const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const {
  ARTIFACT_NAMES,
  DEFAULT_RUNS_ROOT,
  isValidRunId,
} = require('../config');

const CONTENT_TYPES = Object.freeze({
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
});
const OPTIONAL_ARTIFACT_NAMES = new Set([
  'approved-rule-preview.json',
  'approved-rule-preview.md',
  'approved-rule-applications.json',
  'source-report.xlsx',
  'source-report.xls',
]);
const SOURCE_ARTIFACT_NAMES = Object.freeze([
  'source-report.xlsx',
  'source-report.xls',
]);
const WINDOWS_RENAME_RETRY_CODES = new Set([
  'EACCES',
  'EBUSY',
  'EEXIST',
  'EPERM',
]);
const WINDOWS_RENAME_ATTEMPTS = 5;
const WINDOWS_RENAME_RETRY_DELAY_MS = 20;

class ArtifactStoreError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'ArtifactStoreError';
    this.code = code;
  }
}

function assertRunId(runId) {
  if (!isValidRunId(runId)) {
    throw new ArtifactStoreError(
      'INVALID_RUN_ID',
      'Run ID должен быть корректным UUID.'
    );
  }
}

function sleepSync(delayMs) {
  if (delayMs <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, delayMs);
}

function fsyncDirectory(directoryPath, fsModule = fs, options = {}) {
  const platform = options.platform || process.platform;
  // Node/libuv does not provide a portable directory-fsync contract on
  // Windows. The file itself has already been fsynced before rename.
  if (platform === 'win32') return false;

  let descriptor;
  try {
    descriptor = fsModule.openSync(directoryPath, 'r');
    fsModule.fsyncSync(descriptor);
    return true;
  } catch (error) {
    if (options.strict) throw error;
    return false;
  } finally {
    if (descriptor !== undefined) {
      try {
        fsModule.closeSync(descriptor);
      } catch (error) {
        if (options.strict) throw error;
      }
    }
  }
}

function replaceFileAtomic(temporaryPath, filePath, options = {}) {
  const fsModule = options.fsModule || fs;
  const platform = options.platform || process.platform;
  const attempts = platform === 'win32'
    ? options.renameAttempts || WINDOWS_RENAME_ATTEMPTS
    : 1;
  const retryDelayMs = options.renameRetryDelayMs ??
    WINDOWS_RENAME_RETRY_DELAY_MS;
  const wait = options.sleep || sleepSync;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      fsModule.renameSync(temporaryPath, filePath);
      return;
    } catch (error) {
      const retryable = platform === 'win32' &&
        WINDOWS_RENAME_RETRY_CODES.has(error.code) &&
        attempt < attempts;
      if (!retryable) throw error;
      wait(retryDelayMs * attempt);
    }
  }
}

function atomicWriteFile(filePath, content, options = {}) {
  const fsModule = options.fsModule || fs;
  const directoryPath = path.dirname(filePath);
  fsModule.mkdirSync(directoryPath, { recursive: true });
  const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
  const temporaryPath = path.join(
    directoryPath,
    `.${path.basename(filePath)}.${suffix}.tmp`
  );
  let descriptor;
  try {
    descriptor = fsModule.openSync(temporaryPath, 'wx', 0o600);
    fsModule.writeFileSync(descriptor, content, 'utf8');
    fsModule.fsyncSync(descriptor);
    fsModule.closeSync(descriptor);
    descriptor = undefined;
    replaceFileAtomic(temporaryPath, filePath, options);
    // The rename is the commit point. Directory fsync strengthens crash
    // durability where supported, but a failure after commit must not be
    // reported as a failed write (which would trigger unsafe retries).
    fsyncDirectory(directoryPath, fsModule, options);
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
    throw error;
  }
}

function serializeJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function artifactPayloads(bundle) {
  const agentJson = Array.isArray(bundle.agentResult)
    ? bundle.agentResult[0]?.json
    : null;
  const payloads = {
    'result.json': serializeJson(bundle.agentResult),
    'report.txt': `${String(agentJson?.minmax_text || '').trimEnd()}\n`,
    'recommendation-explanations.json': serializeJson(bundle.explanations),
    'recommendation-explanations-report.md':
      `${bundle.explanationsReport.trimEnd()}\n`,
    'matrix-draft.json': serializeJson(bundle.matrixDraft),
    'matrix-report.txt': `${bundle.matrixReportText.trimEnd()}\n`,
    'manual-review.json': serializeJson(bundle.manualReview),
    'owner-review.json': serializeJson(bundle.ownerReview),
    'owner-review-report.md': `${bundle.ownerReviewReport.trimEnd()}\n`,
    'owner-learning-report.json': serializeJson(bundle.ownerLearning),
    'owner-learning-report.md':
      `${bundle.ownerLearningReport.trimEnd()}\n`,
    'owner-learning-patterns.json':
      serializeJson(bundle.ownerLearningPatterns),
    'owner-learning-patterns.md':
      `${bundle.ownerLearningPatternsReport.trimEnd()}\n`,
    'owner-rule-proposals.json':
      serializeJson(bundle.ownerRuleProposals),
    'owner-rule-proposals.md':
      `${bundle.ownerRuleProposalsReport.trimEnd()}\n`,
    'run-metadata.json': serializeJson({
      version: 1,
      run_id: bundle.run_id,
      generated_at: bundle.generated_at,
      status: bundle.status,
    }),
  };
  if (bundle.approvedRulePreview) {
    payloads['approved-rule-preview.json'] =
      serializeJson(bundle.approvedRulePreview);
    payloads['approved-rule-preview.md'] =
      `${bundle.approvedRulePreviewReport.trimEnd()}\n`;
  }
  if (bundle.approvedRuleApplications) {
    payloads['approved-rule-applications.json'] =
      serializeJson(bundle.approvedRuleApplications);
  }
  return payloads;
}

class FileArtifactStore {
  constructor(options = {}) {
    this.runsRoot = path.resolve(options.runsRoot || DEFAULT_RUNS_ROOT);
    this.fs = options.fsModule || fs;
  }

  runDirectory(runId) {
    assertRunId(runId);
    return path.join(this.runsRoot, runId);
  }

  artifactDirectory(runId) {
    return path.join(this.runDirectory(runId), 'artifacts');
  }

  saveBundleArtifacts(bundle) {
    assertRunId(bundle?.run_id);
    const payloads = artifactPayloads(bundle);
    const artifactDirectory = this.artifactDirectory(bundle.run_id);
    const artifacts = ARTIFACT_NAMES.flatMap(name => {
      const content = payloads[name];
      if (typeof content !== 'string') {
        if (OPTIONAL_ARTIFACT_NAMES.has(name)) return [];
        throw new ArtifactStoreError(
          'INVALID_ARTIFACT_CONTENT',
          'Application bundle не содержит обязательный artifact.'
        );
      }
      atomicWriteFile(
        path.join(artifactDirectory, name),
        content,
        { fsModule: this.fs }
      );
      return [{
        name,
        content_type: CONTENT_TYPES[path.extname(name)] ||
          'application/octet-stream',
        size_bytes: Buffer.byteLength(content),
        sha256: sha256(content),
        download_url:
          `/api/v1/runs/${bundle.run_id}/artifacts/${name}`,
      }];
    });
    const manifest = {
      version: 1,
      run_id: bundle.run_id,
      artifacts,
    };
    atomicWriteFile(
      path.join(artifactDirectory, 'manifest.json'),
      serializeJson(manifest),
      { fsModule: this.fs }
    );
    return manifest;
  }

  /**
   * Stores the originally uploaded Excel report as a binary run
   * artifact. The copy is atomic (tmp + fsync + rename), the manifest
   * entry records the sanitized original name, reception timestamp,
   * sha256 and size. Binary content is never logged.
   */
  saveSourceArtifact(runId, sourceFilePath, metadata = {}) {
    assertRunId(runId);
    const extension = path.extname(String(sourceFilePath)).toLowerCase();
    const name = `source-report${extension}`;
    if (!SOURCE_ARTIFACT_NAMES.includes(name)) {
      throw new ArtifactStoreError(
        'INVALID_ARTIFACT_CONTENT',
        'Source artifact должен иметь расширение .xlsx или .xls.'
      );
    }
    const artifactDirectory = this.artifactDirectory(runId);
    let sourceStatus;
    try {
      sourceStatus = this.fs.statSync(sourceFilePath);
    } catch (error) {
      throw new ArtifactStoreError(
        'INVALID_ARTIFACT_CONTENT',
        'Исходный Excel-файл недоступен для сохранения artifact.',
        { cause: error }
      );
    }
    if (!sourceStatus.isFile()) {
      throw new ArtifactStoreError(
        'INVALID_ARTIFACT_CONTENT',
        'Исходный Excel-файл недоступен для сохранения artifact.'
      );
    }

    const suffix = `${process.pid}-${crypto.randomBytes(6).toString('hex')}`;
    const temporaryPath = path.join(
      artifactDirectory,
      `.${name}.${suffix}.tmp`
    );
    let descriptor;
    try {
      this.fs.mkdirSync(artifactDirectory, { recursive: true });
      this.fs.copyFileSync(sourceFilePath, temporaryPath);
      descriptor = this.fs.openSync(temporaryPath, 'r');
      this.fs.fsyncSync(descriptor);
      this.fs.closeSync(descriptor);
      descriptor = undefined;
      this.fs.renameSync(temporaryPath, path.join(artifactDirectory, name));
      fsyncDirectory(artifactDirectory, this.fs);
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          this.fs.closeSync(descriptor);
        } catch {}
      }
      try {
        if (this.fs.existsSync(temporaryPath)) {
          this.fs.unlinkSync(temporaryPath);
        }
      } catch {}
      throw new ArtifactStoreError(
        'ARTIFACT_STREAM_ERROR',
        'Не удалось сохранить исходный Excel как artifact.',
        { cause: error }
      );
    }

    const content = this.fs.readFileSync(
      path.join(artifactDirectory, name)
    );
    const manifest = this.readManifest(runId);
    const artifacts = (
      Array.isArray(manifest.artifacts) ? manifest.artifacts : []
    ).filter(item => !SOURCE_ARTIFACT_NAMES.includes(item?.name));
    artifacts.push({
      name,
      content_type: CONTENT_TYPES[extension] || 'application/octet-stream',
      size_bytes: content.length,
      sha256: sha256(content),
      original_name: typeof metadata.originalName === 'string'
        ? metadata.originalName.slice(0, 256)
        : null,
      received_at: typeof metadata.receivedAt === 'string'
        ? metadata.receivedAt
        : null,
      download_url: `/api/v1/runs/${runId}/artifacts/${name}`,
    });
    atomicWriteFile(
      path.join(artifactDirectory, 'manifest.json'),
      serializeJson({ ...manifest, artifacts }),
      { fsModule: this.fs }
    );
    return artifacts[artifacts.length - 1];
  }

  readManifest(runId) {
    const manifestPath = path.join(
      this.artifactDirectory(runId),
      'manifest.json'
    );
    try {
      return JSON.parse(this.fs.readFileSync(manifestPath, 'utf8'));
    } catch (error) {
      const code = error.code === 'ENOENT'
        ? 'ARTIFACT_MANIFEST_NOT_FOUND'
        : 'ARTIFACT_MANIFEST_INVALID';
      throw new ArtifactStoreError(
        code,
        'Artifact manifest недоступен.',
        { cause: error }
      );
    }
  }

  openArtifactForStreaming(runId, artifactName) {
    assertRunId(runId);
    if (!ARTIFACT_NAMES.includes(artifactName)) {
      throw new ArtifactStoreError(
        'ARTIFACT_NOT_ALLOWED',
        'Artifact не входит в разрешённый whitelist.'
      );
    }

    const artifactDirectory = this.artifactDirectory(runId);
    try {
      const directoryStatus = this.fs.lstatSync(artifactDirectory);
      const manifestStatus = this.fs.lstatSync(path.join(
        artifactDirectory,
        'manifest.json'
      ));
      if (
        directoryStatus.isSymbolicLink() ||
        !directoryStatus.isDirectory() ||
        manifestStatus.isSymbolicLink() ||
        !manifestStatus.isFile()
      ) {
        throw new ArtifactStoreError(
          'ARTIFACT_NOT_ALLOWED',
          'Artifact storage path не разрешён.'
        );
      }
    } catch (error) {
      if (error instanceof ArtifactStoreError) throw error;
      if (error.code === 'ENOENT') {
        throw new ArtifactStoreError(
          'ARTIFACT_NOT_FOUND',
          'Artifact не найден.',
          { cause: error }
        );
      }
      throw new ArtifactStoreError(
        'ARTIFACT_STREAM_ERROR',
        'Artifact storage недоступен.',
        { cause: error }
      );
    }

    let manifest;
    try {
      manifest = this.readManifest(runId);
    } catch (error) {
      throw new ArtifactStoreError(
        error.code === 'ARTIFACT_MANIFEST_NOT_FOUND'
          ? 'ARTIFACT_NOT_FOUND'
          : 'ARTIFACT_STREAM_ERROR',
        error.code === 'ARTIFACT_MANIFEST_NOT_FOUND'
          ? 'Artifact не найден.'
          : 'Artifact manifest повреждён.',
        { cause: error }
      );
    }
    if (manifest.run_id !== runId) {
      throw new ArtifactStoreError(
        'ARTIFACT_STREAM_ERROR',
        'Artifact manifest не принадлежит запрошенному run.'
      );
    }
    const manifestEntry = Array.isArray(manifest.artifacts)
      ? manifest.artifacts.find(item => item?.name === artifactName)
      : null;
    if (!manifestEntry) {
      throw new ArtifactStoreError(
        'ARTIFACT_NOT_FOUND',
        'Artifact не найден.'
      );
    }

    const candidatePath = path.join(artifactDirectory, artifactName);
    let directoryRealPath;
    let artifactRealPath;
    let descriptor;
    try {
      directoryRealPath = this.fs.realpathSync(artifactDirectory);
      const linkStatus = this.fs.lstatSync(candidatePath);
      if (linkStatus.isSymbolicLink() || !linkStatus.isFile()) {
        throw new ArtifactStoreError(
          'ARTIFACT_NOT_ALLOWED',
          'Artifact path не разрешён.'
        );
      }
      artifactRealPath = this.fs.realpathSync(candidatePath);
      const relativePath = path.relative(
        directoryRealPath,
        artifactRealPath
      );
      if (
        relativePath === '' ||
        relativePath.startsWith(`..${path.sep}`) ||
        relativePath === '..' ||
        path.isAbsolute(relativePath)
      ) {
        throw new ArtifactStoreError(
          'ARTIFACT_NOT_ALLOWED',
          'Artifact path выходит за пределы run.'
        );
      }
      const noFollow = this.fs.constants?.O_NOFOLLOW || 0;
      descriptor = this.fs.openSync(
        artifactRealPath,
        this.fs.constants.O_RDONLY | noFollow
      );
      const status = this.fs.fstatSync(descriptor);
      if (
        !status.isFile() ||
        status.size !== manifestEntry.size_bytes
      ) {
        throw new ArtifactStoreError(
          'ARTIFACT_STREAM_ERROR',
          'Artifact не прошёл проверку целостности.'
        );
      }
      const stream = this.fs.createReadStream(null, {
        fd: descriptor,
        autoClose: true,
      });
      descriptor = undefined;
      return {
        name: artifactName,
        contentType: CONTENT_TYPES[path.extname(artifactName)] ||
          'application/octet-stream',
        sizeBytes: status.size,
        stream,
      };
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          this.fs.closeSync(descriptor);
        } catch {}
      }
      if (error instanceof ArtifactStoreError) throw error;
      if (error.code === 'ENOENT') {
        throw new ArtifactStoreError(
          'ARTIFACT_NOT_FOUND',
          'Artifact не найден.',
          { cause: error }
        );
      }
      if (error.code === 'ELOOP') {
        throw new ArtifactStoreError(
          'ARTIFACT_NOT_ALLOWED',
          'Artifact path не разрешён.',
          { cause: error }
        );
      }
      throw new ArtifactStoreError(
        'ARTIFACT_STREAM_ERROR',
        'Не удалось открыть artifact stream.',
        { cause: error }
      );
    }
  }

  removeArtifacts(runId) {
    const artifactDirectory = this.artifactDirectory(runId);
    this.fs.rmSync(artifactDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  ArtifactStoreError,
  CONTENT_TYPES,
  FileArtifactStore,
  OPTIONAL_ARTIFACT_NAMES,
  SOURCE_ARTIFACT_NAMES,
  artifactPayloads,
  assertRunId,
  atomicWriteFile,
  fsyncDirectory,
  replaceFileAtomic,
  serializeJson,
  sha256,
};
