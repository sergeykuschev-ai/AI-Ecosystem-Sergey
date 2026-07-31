const crypto = require('node:crypto');

const { HttpError, sendError, sendSuccess } = require('./responses');

const RUN_ROUTE = /^\/api\/v1\/runs\/([^/]+)$/;
const SUMMARY_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/summary$/;
const ITEMS_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/items$/;
const ITEM_DECISION_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/items\/([^/]+)\/decision$/;
const OWNER_REVIEW_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/owner-review$/;
const BUDGET_OPTIMIZATION_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/budget-optimization$/;
const OWNER_DECISION_ANALYTICS_ROUTE =
  '/api/v1/owner-learning/decision-history/analytics';
const OWNER_LEARNING_CENTER_ROUTE =
  '/api/v1/owner-learning/center';
const OWNER_KNOWLEDGE_HEALTH_ROUTE =
  '/api/v1/owner-learning/knowledge-health';
const OWNER_KNOWLEDGE_HEALTH_FINDINGS_ROUTE =
  '/api/v1/owner-learning/knowledge-health/findings';
const OWNER_KNOWLEDGE_HEALTH_DETAIL_ROUTE =
  /^\/api\/v1\/owner-learning\/knowledge-health\/rules\/([A-Za-z0-9_-]{1,128})$/;
const OWNER_LEARNING_CANDIDATES_ROUTE =
  '/api/v1/owner-learning/candidates';
const OWNER_LEARNING_LIFECYCLE_ROUTE =
  '/api/v1/owner-learning/candidate-lifecycle';
const OWNER_LEARNING_LIFECYCLE_DETAIL_ROUTE =
  /^\/api\/v1\/owner-learning\/candidate-lifecycle\/([0-9a-f]{64})$/;
const OWNER_LEARNING_LIFECYCLE_STATUS_ROUTE =
  /^\/api\/v1\/owner-learning\/candidate-lifecycle\/([0-9a-f]{64})\/status$/;
const OWNER_RULE_MATERIALIZATIONS_ROUTE =
  '/api/v1/owner-learning/rule-materializations';
const OWNER_RULE_MATERIALIZATION_DETAIL_ROUTE =
  /^\/api\/v1\/owner-learning\/rule-materializations\/([0-9a-f]{64})$/;
const OWNER_RULE_MATERIALIZE_ROUTE =
  /^\/api\/v1\/owner-learning\/candidates\/([0-9a-f]{64})\/materialize-rule$/;
const OWNER_MATERIALIZED_RULES_ROUTE =
  '/api/v1/owner-learning/materialized-rules';
const OWNER_MATERIALIZED_RULE_DETAIL_ROUTE =
  /^\/api\/v1\/owner-learning\/materialized-rules\/([A-Za-z0-9_-]{1,128})$/;
const OWNER_MATERIALIZED_RULE_STATUS_PREVIEW_ROUTE =
  /^\/api\/v1\/owner-learning\/materialized-rules\/([A-Za-z0-9_-]{1,128})\/status-preview$/;
const OWNER_MATERIALIZED_RULE_STATUS_ROUTE =
  /^\/api\/v1\/owner-learning\/materialized-rules\/([A-Za-z0-9_-]{1,128})\/status$/;
const OWNER_MATERIALIZED_RULE_STATUS_HISTORY_ROUTE =
  /^\/api\/v1\/owner-learning\/materialized-rules\/([A-Za-z0-9_-]{1,128})\/status-history$/;
const OWNER_RULE_EFFECTIVENESS_ROUTE =
  '/api/v1/owner-learning/rule-effectiveness';
const OWNER_RULE_EFFECTIVENESS_EVENTS_ROUTE =
  /^\/api\/v1\/owner-learning\/rule-effectiveness\/([A-Za-z0-9_-]{1,128})\/events$/;
const OWNER_RULE_EFFECTIVENESS_DETAIL_ROUTE =
  /^\/api\/v1\/owner-learning\/rule-effectiveness\/([A-Za-z0-9_-]{1,128})$/;
const ARTIFACTS_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/artifacts$/;
const ARTIFACT_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/artifacts\/(.*)$/;
const SUPPLIER_ORDER_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/supplier-order$/;
const SUPPLIER_ORDER_DOWNLOAD_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/supplier-order\/download$/;

function queryObject(searchParams) {
  const query = {};
  for (const [name, value] of searchParams) query[name] = value;
  return query;
}

function decodeItemId(rawItemId) {
  let itemId;
  try {
    itemId = decodeURIComponent(rawItemId);
  } catch (error) {
    throw new HttpError(
      'INVALID_ITEM_ID',
      'Item ID имеет недопустимое значение.',
      { cause: error }
    );
  }
  if (
    !itemId ||
    itemId.length > 512 ||
    itemId.includes('\0') ||
    itemId.includes('/') ||
    itemId.includes('\\') ||
    /%(?:00|2e|2f|5c)/i.test(itemId) ||
    itemId === '..'
  ) {
    throw new HttpError(
      'INVALID_ITEM_ID',
      'Item ID имеет недопустимое значение.'
    );
  }
  return itemId;
}

function createRouter(handlers, options = {}) {
  const uuid = options.uuid || crypto.randomUUID;
  const staticHandler = options.staticHandler;

  return async function route(request, response) {
    const requestId = uuid();
    let runId = null;
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      const rawPath = String(request.url || '').split('?')[0];
      let result;

      if (
        request.method === 'GET' &&
        !url.pathname.startsWith('/api/')
      ) {
        if (!staticHandler) {
          throw new HttpError(
            'ROUTE_NOT_FOUND',
            'Запрошенный endpoint не найден.'
          );
        }
        result = await staticHandler(rawPath, response);
      } else if (
        request.method === 'POST' &&
        url.pathname === '/api/v1/runs'
      ) {
        result = await handlers.createRun(request, { requestId });
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_LEARNING_CENTER_ROUTE
      ) {
        result = handlers.getOwnerLearningCenter(
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_KNOWLEDGE_HEALTH_FINDINGS_ROUTE
      ) {
        result = handlers.getOwnerKnowledgeHealthFindings(
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname.match(OWNER_KNOWLEDGE_HEALTH_DETAIL_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_KNOWLEDGE_HEALTH_DETAIL_ROUTE
        );
        result = handlers.getOwnerKnowledgeRuleHealth(
          match[1],
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_KNOWLEDGE_HEALTH_ROUTE
      ) {
        result = handlers.getOwnerKnowledgeHealth(
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_RULE_EFFECTIVENESS_ROUTE
      ) {
        result = handlers.listOwnerRuleEffectiveness(
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname.match(OWNER_RULE_EFFECTIVENESS_EVENTS_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_RULE_EFFECTIVENESS_EVENTS_ROUTE
        );
        result = handlers.getOwnerRuleEffectivenessEvents(
          match[1],
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname.match(OWNER_RULE_EFFECTIVENESS_DETAIL_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_RULE_EFFECTIVENESS_DETAIL_ROUTE
        );
        result = handlers.getOwnerRuleEffectiveness(
          match[1],
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_DECISION_ANALYTICS_ROUTE
      ) {
        result = handlers.getOwnerDecisionAnalytics(
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_LEARNING_CANDIDATES_ROUTE
      ) {
        result = handlers.getOwnerLearningCandidates(
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_LEARNING_LIFECYCLE_ROUTE
      ) {
        result = handlers.getOwnerLearningCandidateStates();
      } else if (
        request.method === 'GET' &&
        url.pathname.match(OWNER_LEARNING_LIFECYCLE_DETAIL_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_LEARNING_LIFECYCLE_DETAIL_ROUTE
        );
        result = handlers.getOwnerLearningCandidateState(match[1]);
      } else if (
        request.method === 'POST' &&
        url.pathname.match(OWNER_LEARNING_LIFECYCLE_STATUS_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_LEARNING_LIFECYCLE_STATUS_ROUTE
        );
        result = await handlers.changeOwnerLearningCandidateStatus(
          match[1],
          request
        );
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_RULE_MATERIALIZATIONS_ROUTE
      ) {
        result = handlers.listOwnerRuleMaterializations();
      } else if (
        request.method === 'GET' &&
        url.pathname.match(
          OWNER_RULE_MATERIALIZATION_DETAIL_ROUTE
        )
      ) {
        const match = url.pathname.match(
          OWNER_RULE_MATERIALIZATION_DETAIL_ROUTE
        );
        result = handlers.getOwnerRuleMaterialization(match[1]);
      } else if (
        request.method === 'POST' &&
        url.pathname.match(OWNER_RULE_MATERIALIZE_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_RULE_MATERIALIZE_ROUTE
        );
        result = await handlers.materializeOwnerRule(
          match[1],
          request
        );
      } else if (
        request.method === 'POST' &&
        url.pathname.match(
          OWNER_MATERIALIZED_RULE_STATUS_PREVIEW_ROUTE
        )
      ) {
        const match = url.pathname.match(
          OWNER_MATERIALIZED_RULE_STATUS_PREVIEW_ROUTE
        );
        result = await handlers.previewOwnerRuleStatus(
          match[1],
          request
        );
      } else if (
        request.method === 'POST' &&
        url.pathname.match(OWNER_MATERIALIZED_RULE_STATUS_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_MATERIALIZED_RULE_STATUS_ROUTE
        );
        result = await handlers.changeOwnerRuleStatus(
          match[1],
          request
        );
      } else if (
        request.method === 'GET' &&
        url.pathname.match(
          OWNER_MATERIALIZED_RULE_STATUS_HISTORY_ROUTE
        )
      ) {
        const match = url.pathname.match(
          OWNER_MATERIALIZED_RULE_STATUS_HISTORY_ROUTE
        );
        result = handlers.getOwnerRuleStatusHistory(match[1]);
      } else if (
        request.method === 'GET' &&
        url.pathname === OWNER_MATERIALIZED_RULES_ROUTE
      ) {
        result = handlers.listOwnerMaterializedRules(
          queryObject(url.searchParams)
        );
      } else if (
        request.method === 'GET' &&
        url.pathname.match(OWNER_MATERIALIZED_RULE_DETAIL_ROUTE)
      ) {
        const match = url.pathname.match(
          OWNER_MATERIALIZED_RULE_DETAIL_ROUTE
        );
        result = handlers.getOwnerMaterializedRule(match[1]);
      } else {
        const statusMatch = request.method === 'GET' &&
          url.pathname.match(RUN_ROUTE);
        const summaryMatch = request.method === 'GET' &&
          url.pathname.match(SUMMARY_ROUTE);
        const itemsMatch = request.method === 'GET' &&
          url.pathname.match(ITEMS_ROUTE);
        const itemDecisionMatch = request.method === 'PUT' &&
          rawPath.match(ITEM_DECISION_ROUTE);
        const budgetOptimizationMatch = request.method === 'POST' &&
          rawPath.match(BUDGET_OPTIMIZATION_ROUTE);
        const ownerReviewMatch = request.method === 'GET' &&
          url.pathname.match(OWNER_REVIEW_ROUTE);
        const artifactsMatch = request.method === 'GET' &&
          url.pathname.match(ARTIFACTS_ROUTE);
        const artifactMatch = request.method === 'GET' &&
          rawPath.match(ARTIFACT_ROUTE);
        const supplierOrderDownloadMatch = request.method === 'GET' &&
          rawPath.match(SUPPLIER_ORDER_DOWNLOAD_ROUTE);
        const supplierOrderMatch = request.method === 'GET' &&
          url.pathname.match(SUPPLIER_ORDER_ROUTE);

        if (supplierOrderDownloadMatch) {
          runId = supplierOrderDownloadMatch[1];
          result = await handlers.downloadSupplierOrder(
            runId,
            response
          );
        } else if (supplierOrderMatch) {
          runId = supplierOrderMatch[1];
          result = handlers.getSupplierOrder(runId);
        } else if (budgetOptimizationMatch) {
          runId = budgetOptimizationMatch[1];
          result = await handlers.optimizeBudget(runId, request);
        } else if (itemDecisionMatch) {
          runId = itemDecisionMatch[1];
          result = await handlers.saveOwnerDecision(
            runId,
            decodeItemId(itemDecisionMatch[2]),
            request
          );
        } else if (artifactMatch) {
          runId = artifactMatch[1];
          result = await handlers.downloadArtifact(
            runId,
            artifactMatch[2],
            response
          );
        } else if (artifactsMatch) {
          runId = artifactsMatch[1];
          result = handlers.listArtifacts(runId);
        } else if (summaryMatch) {
          runId = summaryMatch[1];
          result = handlers.getRunSummary(runId);
        } else if (itemsMatch) {
          runId = itemsMatch[1];
          result = handlers.listItems(
            runId,
            queryObject(url.searchParams)
          );
        } else if (ownerReviewMatch) {
          runId = ownerReviewMatch[1];
          result = handlers.getOwnerReview(
            runId,
            queryObject(url.searchParams)
          );
        } else if (statusMatch) {
          runId = statusMatch[1];
          result = handlers.getRunStatus(runId);
        } else {
          throw new HttpError(
            'ROUTE_NOT_FOUND',
            'Запрошенный API endpoint не найден.'
          );
        }
      }

      runId = result.runId || runId;
      if (result.streamed) return;
      sendSuccess(
        response,
        result.statusCode,
        result.data,
        result.headers
      );
    } catch (error) {
      runId = error.runId || runId;
      if (!response.headersSent) {
        sendError(response, error, { requestId, runId });
      } else {
        response.destroy();
      }
    }
  };
}

module.exports = {
  ARTIFACT_ROUTE,
  ARTIFACTS_ROUTE,
  BUDGET_OPTIMIZATION_ROUTE,
  ITEM_DECISION_ROUTE,
  ITEMS_ROUTE,
  OWNER_REVIEW_ROUTE,
  OWNER_DECISION_ANALYTICS_ROUTE,
  OWNER_LEARNING_CENTER_ROUTE,
  OWNER_KNOWLEDGE_HEALTH_DETAIL_ROUTE,
  OWNER_KNOWLEDGE_HEALTH_FINDINGS_ROUTE,
  OWNER_KNOWLEDGE_HEALTH_ROUTE,
  OWNER_LEARNING_CANDIDATES_ROUTE,
  OWNER_LEARNING_LIFECYCLE_DETAIL_ROUTE,
  OWNER_LEARNING_LIFECYCLE_ROUTE,
  OWNER_LEARNING_LIFECYCLE_STATUS_ROUTE,
  OWNER_MATERIALIZED_RULES_ROUTE,
  OWNER_MATERIALIZED_RULE_DETAIL_ROUTE,
  OWNER_MATERIALIZED_RULE_STATUS_HISTORY_ROUTE,
  OWNER_MATERIALIZED_RULE_STATUS_PREVIEW_ROUTE,
  OWNER_MATERIALIZED_RULE_STATUS_ROUTE,
  OWNER_RULE_MATERIALIZATIONS_ROUTE,
  OWNER_RULE_MATERIALIZATION_DETAIL_ROUTE,
  OWNER_RULE_MATERIALIZE_ROUTE,
  OWNER_RULE_EFFECTIVENESS_ROUTE,
  OWNER_RULE_EFFECTIVENESS_DETAIL_ROUTE,
  OWNER_RULE_EFFECTIVENESS_EVENTS_ROUTE,
  RUN_ROUTE,
  SUMMARY_ROUTE,
  SUPPLIER_ORDER_DOWNLOAD_ROUTE,
  SUPPLIER_ORDER_ROUTE,
  createRouter,
  decodeItemId,
  queryObject,
};
