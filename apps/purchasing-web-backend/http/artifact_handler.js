const { pipeline } = require('node:stream/promises');

const { ARTIFACT_NAMES } = require('../config');
const { HttpError } = require('./responses');

const ARTIFACT_WHITELIST = new Map(
  ARTIFACT_NAMES.map(name => [name, name])
);

function decodeArtifactName(rawName) {
  let decoded;
  try {
    decoded = decodeURIComponent(rawName);
  } catch (error) {
    throw new HttpError(
      'INVALID_ARTIFACT_NAME',
      'Artifact name содержит некорректное кодирование.',
      { cause: error }
    );
  }
  if (
    decoded === '' ||
    decoded.includes('..') ||
    decoded.includes('/') ||
    decoded.includes('\\') ||
    decoded.includes('\0')
  ) {
    throw new HttpError(
      'INVALID_ARTIFACT_NAME',
      'Artifact name содержит запрещённые символы.'
    );
  }
  const safeName = ARTIFACT_WHITELIST.get(decoded);
  if (!safeName) {
    throw new HttpError(
      'ARTIFACT_NOT_ALLOWED',
      'Artifact не входит в разрешённый whitelist.'
    );
  }
  return safeName;
}

function ensureArtifactRunReady(queryService, runId) {
  const status = queryService.getRunStatus(runId);
  if (status.status === 'failed') {
    throw new HttpError('RUN_FAILED', 'Run завершился ошибкой.');
  }
  if (status.status !== 'completed') {
    throw new HttpError('RUN_NOT_READY', 'Run ещё не завершён.');
  }
}

async function streamArtifact({
  artifactStore,
  queryService,
  response,
  runId,
  rawArtifactName,
}) {
  ensureArtifactRunReady(queryService, runId);
  const artifactName = decodeArtifactName(rawArtifactName);
  let opened;
  try {
    opened = artifactStore.openArtifactForStreaming(
      runId,
      artifactName
    );
  } catch (error) {
    if (
      error?.code === 'ARTIFACT_NOT_ALLOWED' ||
      error?.code === 'ARTIFACT_NOT_FOUND' ||
      error?.code === 'ARTIFACT_STREAM_ERROR'
    ) {
      throw new HttpError(error.code, error.message, { cause: error });
    }
    throw new HttpError(
      'ARTIFACT_STREAM_ERROR',
      'Не удалось открыть artifact stream.',
      { cause: error }
    );
  }

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${opened.name}"`,
    'Content-Length': opened.sizeBytes,
    'Content-Type': opened.contentType,
    'X-Content-Type-Options': 'nosniff',
  });
  try {
    await pipeline(opened.stream, response);
  } catch (error) {
    throw new HttpError(
      'ARTIFACT_STREAM_ERROR',
      'Не удалось передать artifact.',
      { cause: error }
    );
  }
}

module.exports = {
  ARTIFACT_WHITELIST,
  decodeArtifactName,
  ensureArtifactRunReady,
  streamArtifact,
};
