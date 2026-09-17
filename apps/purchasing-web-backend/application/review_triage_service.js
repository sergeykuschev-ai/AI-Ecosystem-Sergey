'use strict';

/**
 * Thin read-only adapter between the Purchasing Web backend and the
 * review_triage agent module. The service loads the canonical matrix and the
 * verified owner-review session registry (fail-safe, same semantics as
 * scripts/triage-purchasing-review.js), runs triageReviewQueue on the run
 * bundle and persists the two triage artifacts through the existing
 * FileArtifactStore whitelist.
 *
 * The triage is auxiliary: every failure is the caller's decision, the
 * service itself never mutates run data, canonical values, Min/Max or owner
 * decisions.
 */

const fs = require('node:fs');
const path = require('node:path');

const {
  DEFAULT_SERVER_PATHS,
  REPOSITORY_ROOT,
} = require('../config');
const { triageReviewQueue } = require(
  '../../../agents/purchasing/review_triage/review_triage'
);
const {
  serializeJson,
} = require('../storage/file_artifact_store');

const REVIEW_TRIAGE_ARTIFACT = 'review-triage.json';
const OWNER_REVIEW_COMPACTION_ARTIFACT = 'owner-review-compaction.json';

function extractAgentJson(raw) {
  let value = raw;
  if (Array.isArray(value) && value.length > 0) {
    value = value[0];
  }
  if (value && typeof value === 'object' && value.json &&
      typeof value.json === 'object') {
    return value.json;
  }
  return value && typeof value === 'object' ? value : {};
}

function createReviewTriageService(options = {}) {
  const matrixPath = options.matrixPath ||
    DEFAULT_SERVER_PATHS.matrixPath;
  const sessionsPath = options.sessionsPath ||
    DEFAULT_SERVER_PATHS.ownerReviewSessionsPath;
  const artifactStore = options.artifactStore || null;
  const logger = options.logger || console;
  const now = options.now || (() => new Date().toISOString());

  function warn(message) {
    try {
      logger.warn(message);
    } catch {}
  }

  /**
   * Read-only canonical matrix load. Absent file -> null + warning
   * (POLICY A auto-resolution disables itself inside review_triage).
   */
  function loadCanonicalMatrix() {
    if (!fs.existsSync(matrixPath)) {
      warn(
        '[TRIAGE_MATRIX_WARNING] canonical matrix not found; ' +
        'POLICY A auto-resolution disabled.'
      );
      return null;
    }
    try {
      return JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
    } catch (error) {
      warn(`[TRIAGE_MATRIX_WARNING] ${error.message}`);
      return null;
    }
  }

  /**
   * Fail-safe load of the verified owner-review session registry:
   *   - missing file  -> [];
   *   - broken JSON   -> [] + warning;
   *   - session without control_artifact_path, or with a path that does not
   *     resolve to an existing file (relative paths against the repository
   *     root, mirroring the CLI loader) -> skipped.
   */
  function loadOwnerReviewSessions() {
    if (!fs.existsSync(sessionsPath)) {
      return [];
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(sessionsPath, 'utf8'));
    } catch (error) {
      warn(
        '[TRIAGE_SESSIONS_WARNING] broken registry ' +
        `(${error.message}); POLICY A auto-resolution disabled.`
      );
      return [];
    }
    const sessions = [];
    const list = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    for (const session of list) {
      const sessionId = typeof session?.session_id === 'string'
        ? session.session_id.trim()
        : '';
      if (!sessionId) continue;
      const artifactPath = typeof session?.control_artifact_path === 'string'
        ? session.control_artifact_path.trim()
        : '';
      if (!artifactPath) {
        warn(
          `[TRIAGE_SESSIONS_WARNING] session ${sessionId} has no ` +
          'control artifact; skipped.'
        );
        continue;
      }
      if (!fs.existsSync(path.resolve(REPOSITORY_ROOT, artifactPath))) {
        warn(
          `[TRIAGE_SESSIONS_WARNING] session ${sessionId} control ` +
          `artifact not found (${artifactPath}); skipped.`
        );
        continue;
      }
      sessions.push({
        session_id: sessionId,
        verified_at: session.verified_at ?? null,
        verified_by: session.verified_by ?? null,
        control_artifact_path: artifactPath,
      });
    }
    return sessions;
  }

  /**
   * Builds the review triage for a completed run and persists both artifacts
   * (review-triage.json + owner-review-compaction.json) via the artifact
   * store whitelist.
   *
   * @param {object} input - { runId, agentJson|agentResult, manualReview,
   *   ownerReview, artifactStore?, generatedAt? }
   * @returns {{triage: object, compaction: object}}
   */
  function buildAndSaveReviewTriage(input) {
    if (!input || typeof input !== 'object') {
      throw new TypeError('buildAndSaveReviewTriage requires an input object.');
    }
    const { runId, manualReview, ownerReview } = input;
    const store = input.artifactStore || artifactStore;
    const bundle = {
      runId,
      agentJson: extractAgentJson(
        input.agentJson !== undefined ? input.agentJson : input.agentResult
      ),
      manualReview: manualReview || {},
      ownerReview: ownerReview || {},
      canonicalMatrix: loadCanonicalMatrix(),
      ownerReviewSessions: loadOwnerReviewSessions(),
    };
    const triage = triageReviewQueue(bundle, {
      generatedAt: input.generatedAt || now(),
    });
    const compaction = triage.owner_review_compaction;
    if (store && typeof store.saveSupplementaryArtifacts === 'function') {
      store.saveSupplementaryArtifacts(runId, {
        [REVIEW_TRIAGE_ARTIFACT]: serializeJson(triage),
        [OWNER_REVIEW_COMPACTION_ARTIFACT]: serializeJson(compaction),
      });
    }
    return { triage, compaction };
  }

  return {
    buildAndSaveReviewTriage,
    loadCanonicalMatrix,
    loadOwnerReviewSessions,
  };
}

module.exports = {
  OWNER_REVIEW_COMPACTION_ARTIFACT,
  REVIEW_TRIAGE_ARTIFACT,
  createReviewTriageService,
  extractAgentJson,
};
