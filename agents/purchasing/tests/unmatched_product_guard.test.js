const assert = require('node:assert/strict');
const { test } = require('node:test');
const { guardUnmatchedProduct } = require('../services/unmatched_product_guard');
const { buildWorkingOrder } = require('../services/working_order');

test('unmatched demand is preserved for review without analyzer fallback permission', () => {
  const product = {
    rowIdentity: 'synthetic:1', assortmentPolicy: { matched: false },
    demandCalculatedQuantity: 3, finalRecommendedQuantity: 3,
    analyzerCalculatedQuantity: 99, priceNum: 10,
  };
  const decision = {
    rowIdentity: product.rowIdentity, decision: 'recommended',
    decisionBasis: 'phase2_calculated', approvedOrderQuantity: 3,
    reasons: [], warnings: [], requiredData: [],
  };
  const original = structuredClone({ product, decision });
  const guarded = guardUnmatchedProduct(product, decision);
  assert.equal(guarded.decision.decision, 'manual_review');
  assert.equal(guarded.decision.approvedOrderQuantity, null);
  assert.equal(guarded.product.demandCalculatedQuantity, 3);
  const working = buildWorkingOrder([guarded.product], [guarded.decision]);
  assert.equal(working.products[0].provisionalOrderQuantity, 3);
  assert.equal(working.summary.autoApprovedLines, 0);
  assert.deepEqual({ product, decision }, original);
  const matched = { ...product, assortmentPolicy: { matched: true } };
  assert.equal(guardUnmatchedProduct(matched, decision).decision, decision);
  const zero = { ...product, demandCalculatedQuantity: 0, finalRecommendedQuantity: 0 };
  const noBuy = { ...decision, decision: 'do_not_buy', approvedOrderQuantity: 0 };
  assert.equal(guardUnmatchedProduct(zero, noBuy).product.unmatchedGuard.classification,
    'UNMATCHED_CONFIDENTLY_EXCLUDED');
  assert.equal(guardUnmatchedProduct(zero, { ...noBuy, requiredData: ['sales'] }).decision.decision,
    'manual_review');
  const unavailable = { ...product, demandCalculatedQuantity: null, finalRecommendedQuantity: null };
  assert.equal(buildWorkingOrder([unavailable], [decision]).products[0].provisionalOrderQuantity, null);
});


test('ambiguous matrix matching cannot be overridden by a later policy match', () => {
  const { matchAssortmentMatrix } = require('../services/assortment_matrix_loader');
  const { buildAmbiguousAssortmentIndex } = require('../services/unmatched_product_guard');
  const products = [1, 2].map(number => ({
    rowIdentity: `duplicate:${number}`, rowNumber: number,
    article: 'PET-100', name: `Synthetic treat variant ${number}`,
    assortmentPolicy: { matched: true },
    demandCalculatedQuantity: number, finalRecommendedQuantity: number,
    analyzerCalculatedQuantity: 99, priceNum: 10,
  }));
  const matrix = { items: [{ normalized_article: 'pet-100', normalized_name: '' }] };
  const matchResult = matchAssortmentMatrix(matrix, products);
  assert.equal(matchResult.itemResults[0].status, 'ambiguous');
  const original = structuredClone(products);
  const decisions = products.map(product => ({
    rowIdentity: product.rowIdentity, decision: 'recommended',
    decisionBasis: 'phase2_calculated', approvedOrderQuantity: product.finalRecommendedQuantity,
    reasons: [], warnings: [], requiredData: [],
  }));
  assert.equal(guardUnmatchedProduct(products[0], decisions[0], matchResult.itemResults).decision.decision, 'manual_review');
  const conflicts = buildAmbiguousAssortmentIndex(matchResult.itemResults);
  for (let index = 0; index < products.length; index += 1) {
    const pair = guardUnmatchedProduct(products[index], decisions[index], conflicts.get(products[index].rowIdentity));
    assert.equal(pair.decision.decision, 'manual_review');
    assert.equal(pair.decision.approvedOrderQuantity, null);
    assert.ok(pair.decision.reasons.includes('ambiguous_assortment_match'));
    assert.equal(pair.product.demandCalculatedQuantity, index + 1);
    assert.deepEqual(pair.product.unmatchedGuard.provenance.ambiguousMatches[0].candidateRowIdentities,
      products.map(product => product.rowIdentity));
    const repeated = guardUnmatchedProduct(pair.product, pair.decision);
    assert.deepEqual(repeated, pair);
    const line = buildWorkingOrder([pair.product], [pair.decision]).products[0];
    assert.equal(line.workflowStatus, 'pending_manual_review');
    assert.equal(line.blockingReason, 'ambiguous_assortment_match');
    assert.equal(line.provisionalOrderQuantity, index + 1);
  }
  assert.deepEqual(products, original);
  const unique = matchAssortmentMatrix(matrix, [products[0]]);
  assert.equal(unique.itemResults[0].status, 'matched');
  assert.equal(buildAmbiguousAssortmentIndex(unique.itemResults).size, 0);
  assert.equal(guardUnmatchedProduct(products[0], decisions[0]).decision, decisions[0]);
  for (const quantity of [0, null]) {
    const product = { ...products[0], demandCalculatedQuantity: quantity, finalRecommendedQuantity: quantity };
    const pair = guardUnmatchedProduct(product,
      { ...decisions[0], decision: 'do_not_buy', approvedOrderQuantity: 0 },
      conflicts.get(product.rowIdentity));
    assert.equal(pair.decision.decision, 'manual_review');
    assert.equal(pair.decision.approvedOrderQuantity, null);
    assert.equal(pair.product.demandCalculatedQuantity, quantity);
    assert.equal(pair.product.unmatchedGuard.classification, 'UNMATCHED_REVIEW_REQUIRED');
  }
});
