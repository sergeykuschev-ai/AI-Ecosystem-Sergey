'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const DEFAULT_OWNER_REVIEW_SESSIONS_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/owner-review-sessions.json'
);

function asDateOnly(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function loadVerifiedOwnerSessionIds(options = {}) {
  const registryPath = options.registryPath || DEFAULT_OWNER_REVIEW_SESSIONS_PATH;
  if (!fs.existsSync(registryPath)) return new Set();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  } catch {
    return new Set();
  }
  const ids = new Set();
  for (const session of Array.isArray(parsed?.sessions) ? parsed.sessions : []) {
    const sessionId = typeof session?.session_id === 'string'
      ? session.session_id.trim()
      : '';
    const artifactPath = typeof session?.control_artifact_path === 'string'
      ? session.control_artifact_path.trim()
      : '';
    if (!sessionId || !artifactPath) continue;
    const resolvedArtifact = path.resolve(REPOSITORY_ROOT, artifactPath);
    if (!fs.existsSync(resolvedArtifact)) continue;
    ids.add(sessionId);
  }
  return ids;
}

function isActiveTestWindow(canonical, currentDate) {
  const day = asDateOnly(currentDate) || asDateOnly(new Date());
  if (!day) return false;
  const start = asDateOnly(canonical?.test_start_date);
  const review = asDateOnly(canonical?.test_review_date);
  if (start && day < start) return false;
  if (review && day > review) return false;
  return true;
}
function applyVerifiedOwnerTestPolicy(product, decision, options = {}) {
  if (!product || !decision) return { product, decision, applied: false };
  if (decision.decision !== 'manual_review') {
    return { product, decision, applied: false };
  }
  const riskReason = (decision.reasons || []).find(
    reason => typeof reason === 'string' && reason.startsWith('abc_xyz_risk:')
  );
  if (!riskReason) return { product, decision, applied: false };

  const policy = product.assortmentPolicy;
  const canonical = policy?.canonical;
  const changedBy = canonical?.rule_changed_by;
  const verifiedIds = options.verifiedSessionIds || new Set();
  if (
    policy?.matched !== true ||
    policy?.assortment_status !== 'TEST' ||
    policy?.rollout_status !== 'ACTIVE' ||
    policy?.purchase_hold === true ||
    !changedBy ||
    !verifiedIds.has(changedBy)
  ) {
    return { product, decision, applied: false };
  }
  if (!isActiveTestWindow(canonical, options.currentDate)) {
    return { product, decision, applied: false };
  }
  if (!(typeof product.freeStock === 'number' && Number.isFinite(product.freeStock))) {
    return { product, decision, applied: false };
  }
  const quantity = product.finalRecommendedQuantity;
  if (!(Number.isInteger(quantity) && quantity > 0)) {
    return { product, decision, applied: false };
  }

  const marker = {
    applied: true,
    sessionId: changedBy,
    skuId: canonical?.sku_id || null,
    quantity,
    riskReason,
    currentDate: asDateOnly(options.currentDate),
  };
  const nextProduct = {
    ...product,
    verifiedOwnerTestPolicyResolution: marker,
  };
  const auditReason = `verified_owner_test_policy:${changedBy}`;
  const riskAudit = `${riskReason}:overridden_by_verified_owner_test_policy`;
  return {
    product: nextProduct,
    decision: {
      ...decision,
      decision: 'recommended',
      approvedOrderQuantity: quantity,
      decisionBasis: 'verified_owner_test_policy',
      reasons: [
        auditReason,
        riskAudit,
        ...(decision.reasons || []).filter(reason => reason !== riskReason),
      ],
    },
    applied: true,
  };
}

module.exports = {
  DEFAULT_OWNER_REVIEW_SESSIONS_PATH,
  loadVerifiedOwnerSessionIds,
  applyVerifiedOwnerTestPolicy,
};
