'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  loadVerifiedOwnerSessionIds,
  applyVerifiedOwnerTestPolicy,
} = require('../services/verified_owner_test_policy');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'owner-test-policy-'));
  const control = path.join(dir, 'control.xlsx');
  const registry = path.join(dir, 'sessions.json');
  fs.writeFileSync(control, 'control');
  fs.writeFileSync(registry, JSON.stringify({ sessions: [{
    session_id: 'owner-review-test',
    control_artifact_path: control,
  }] }));
  return { dir, registry };
}
function product(overrides = {}) {
  return {
    rowIdentity: 'row:test',
    freeStock: 0,
    finalRecommendedQuantity: 1,
    assortmentPolicy: {
      matched: true,
      assortment_status: 'TEST',
      rollout_status: 'ACTIVE',
      purchase_hold: false,
      canonical: {
        sku_id: 'MAT-001',
        rule_changed_by: 'owner-review-test',
        test_start_date: '2026-08-19',
        test_review_date: '2026-11-17',
      },
    },
    ...overrides,
  };
}

function decision() {
  return {
    rowIdentity: 'row:test',
    decision: 'manual_review',
    approvedOrderQuantity: null,
    decisionBasis: 'phase2_risk_review',
    reasons: ['abc_xyz_risk:C/Z', 'quantity_reason:mandatory_assortment'],
    warnings: [],
    requiredData: [],
  };
}

test('verified active OWNER TEST overrides only ABC/XYZ manual risk', () => {
  const { dir, registry } = fixture();
  try {
    const verified = loadVerifiedOwnerSessionIds({ registryPath: registry });
    const result = applyVerifiedOwnerTestPolicy(product(), decision(), {
      verifiedSessionIds: verified,
      currentDate: '2026-09-11',
    });
    assert.equal(result.applied, true);
    assert.equal(result.decision.decision, 'recommended');
    assert.equal(result.decision.approvedOrderQuantity, 1);
    assert.equal(result.decision.decisionBasis, 'verified_owner_test_policy');
    assert.equal(result.product.verifiedOwnerTestPolicyResolution.sessionId, 'owner-review-test');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
