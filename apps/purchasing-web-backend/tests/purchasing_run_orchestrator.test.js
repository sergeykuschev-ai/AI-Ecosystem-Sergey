const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  buildMatrixDraftFromSmartZapasXlsx,
} = require(
  '../../../agents/purchasing/matrix_builder/matrix_builder'
);
const {
  runOrderAgentFromSmartZapasXlsxWithDemand,
} = require('../../../agents/purchasing/order_agent');
const {
  PurchasingWebApplicationError,
} = require('../application/application_error');
const {
  runPurchasingWebOrchestrator,
} = require('../application/purchasing_run_orchestrator');

const REPOSITORY_ROOT = path.resolve(__dirname, '../../..');
const FIXTURE_PATH = path.join(
  REPOSITORY_ROOT,
  'tests/fixtures/SmartZapas_synthetic.xlsx'
);
const FINANCIAL_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-financial-current.json'
);
const MATRIX_CONFIG_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-matrix-builder-config.json'
);
const MATRIX_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-assortment-matrix.json'
);
const OWNER_DECISIONS_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-owner-decisions.json'
);
const RECOMMENDATION_CONFIG_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-recommendation-explainer-config.json'
);
const RUN_ID = 'run-fixture-001';
const GENERATED_AT = '2026-07-23T00:00:00.000Z';

function runRequest() {
  return {
    runId: RUN_ID,
    inputPath: FIXTURE_PATH,
    generatedAt: GENERATED_AT,
    financialDataPath: FINANCIAL_PATH,
    configPath: MATRIX_CONFIG_PATH,
    matrixPath: MATRIX_PATH,
    ownerDecisionsPath: OWNER_DECISIONS_PATH,
    recommendationConfigPath: RECOMMENDATION_CONFIG_PATH,
  };
}

test('full fixture pipeline returns one consistent in-memory bundle', async () => {
  const bundle = await runPurchasingWebOrchestrator(runRequest());
  const agentJson = bundle.agentResult[0].json;

  assert.equal(bundle.run_id, RUN_ID);
  assert.equal(bundle.generated_at, GENERATED_AT);
  assert.equal(bundle.status, 'completed');
  assert.equal(agentJson.product_rows_count, 6);
  assert.equal(bundle.matrixDraft.items.length, 6);
  assert.equal(bundle.ownerReview.items.length, 6);
  assert.equal(bundle.explanations.source_product_count, 6);
  assert.equal(bundle.explanations.explained_sku_count, 6);
  assert.equal(bundle.explanations.items.length, 6);
  assert.equal(typeof bundle.ownerReviewReport, 'string');
  assert.equal(typeof bundle.explanationsReport, 'string');
  assert.equal(typeof bundle.matrixReportText, 'string');
  assert.deepEqual(
    bundle.ownerDecisionSummary,
    bundle.ownerReview.owner_decisions
  );
});

test('every Purchasing Agent SKU has an explanation', async () => {
  const bundle = await runPurchasingWebOrchestrator(runRequest());
  const products = bundle.agentResult[0].json.demandProducts;

  products.forEach((product, index) => {
    const expectedSku = product.article ||
      product.barcode ||
      product.internalProductId ||
      product.rowIdentity;
    assert.equal(bundle.explanations.items[index].sku, expectedSku);
  });
});

test('count mismatch raises a safe controlled application error', async () => {
  await assert.rejects(
    () => runPurchasingWebOrchestrator(runRequest(), {
      buildExplanations(agentResult, options) {
        const {
          buildRecommendationExplanations,
        } = require(
          '../../../agents/purchasing/explanations/recommendation_explainer'
        );
        const explanations = buildRecommendationExplanations(
          agentResult,
          options
        );
        return {
          ...explanations,
          explained_sku_count: explanations.explained_sku_count - 1,
        };
      },
    }),
    error => {
      assert.ok(error instanceof PurchasingWebApplicationError);
      assert.equal(error.code, 'RUN_CONSISTENCY_ERROR');
      assert.deepEqual(error.toPublicData(), {
        code: 'RUN_CONSISTENCY_ERROR',
        message: 'Recommendation Explainer покрыл не все SKU Purchasing Agent.',
      });
      assert.equal('stack' in error.toPublicData(), false);
      assert.equal(
        error.toPublicData().message.includes(REPOSITORY_ROOT),
        false
      );
      return true;
    }
  );
});

test('Owner Review cannot reference an unknown SKU', async () => {
  await assert.rejects(
    () => runPurchasingWebOrchestrator(runRequest(), {
      buildOwnerReview(draft, manualReview, config, summary) {
        const {
          buildOwnerReviewModel,
        } = require(
          '../../../agents/purchasing/matrix_builder/owner_review_dashboard'
        );
        const model = buildOwnerReviewModel(
          draft,
          manualReview,
          config,
          summary
        );
        return {
          ...model,
          sections: {
            ...model.sections,
            owner_action_required: [
              ...model.sections.owner_action_required,
              'unknown-row-identity',
            ],
          },
        };
      },
    }),
    error => {
      assert.ok(error instanceof PurchasingWebApplicationError);
      assert.equal(error.code, 'RUN_CONSISTENCY_ERROR');
      return true;
    }
  );
});

test('orchestrator does not mutate source domain objects', async () => {
  let sourceAgentResult;
  let sourceMatrixResult;
  let agentSnapshot;
  let matrixSnapshot;

  await runPurchasingWebOrchestrator(runRequest(), {
    async runAgent(...args) {
      sourceAgentResult = await runOrderAgentFromSmartZapasXlsxWithDemand(
        ...args
      );
      agentSnapshot = structuredClone(sourceAgentResult);
      return sourceAgentResult;
    },
    async buildMatrix(...args) {
      sourceMatrixResult = await buildMatrixDraftFromSmartZapasXlsx(...args);
      matrixSnapshot = structuredClone(sourceMatrixResult);
      return sourceMatrixResult;
    },
  });

  assert.deepEqual(sourceAgentResult, agentSnapshot);
  assert.deepEqual(sourceMatrixResult, matrixSnapshot);
});
