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
});

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

function fsyncDirectory(directoryPath, fsModule = fs) {
  let descriptor;
  try {
    descriptor = fsModule.openSync(directoryPath, 'r');
    fsModule.fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) fsModule.closeSync(descriptor);
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
    fsModule.renameSync(temporaryPath, filePath);
    fsyncDirectory(directoryPath, fsModule);
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
  return {
    'result.json': serializeJson(bundle.agentResult),
    'matrix-draft.json': serializeJson(bundle.matrixDraft),
    'manual-review.json': serializeJson(bundle.manualReview),
    'owner-review.json': serializeJson(bundle.ownerReview),
    'owner-review-report.md': `${bundle.ownerReviewReport.trimEnd()}\n`,
    'recommendation-explanations.json': serializeJson(bundle.explanations),
    'recommendation-explanations-report.md':
      `${bundle.explanationsReport.trimEnd()}\n`,
    'matrix-report.txt': `${bundle.matrixReportText.trimEnd()}\n`,
    'run-metadata.json': serializeJson({
      version: 1,
      run_id: bundle.run_id,
      generated_at: bundle.generated_at,
      status: bundle.status,
    }),
  };
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
    const artifacts = ARTIFACT_NAMES.map(name => {
      const content = payloads[name];
      if (typeof content !== 'string') {
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
      return {
        name,
        content_type: CONTENT_TYPES[path.extname(name)] ||
          'application/octet-stream',
        size_bytes: Buffer.byteLength(content),
        sha256: sha256(content),
      };
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

  removeArtifacts(runId) {
    const artifactDirectory = this.artifactDirectory(runId);
    this.fs.rmSync(artifactDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  ArtifactStoreError,
  CONTENT_TYPES,
  FileArtifactStore,
  artifactPayloads,
  assertRunId,
  atomicWriteFile,
  fsyncDirectory,
  serializeJson,
  sha256,
};
