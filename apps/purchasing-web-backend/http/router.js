const crypto = require('node:crypto');

const { HttpError, sendError, sendSuccess } = require('./responses');

const RUN_ROUTE = /^\/api\/v1\/runs\/([^/]+)$/;
const SUMMARY_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/summary$/;
const ITEMS_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/items$/;
const ITEM_DECISION_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/items\/([^/]+)\/decision$/;
const OWNER_REVIEW_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/owner-review$/;
const ARTIFACTS_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/artifacts$/;
const ARTIFACT_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/artifacts\/(.*)$/;

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
      } else {
        const statusMatch = request.method === 'GET' &&
          url.pathname.match(RUN_ROUTE);
        const summaryMatch = request.method === 'GET' &&
          url.pathname.match(SUMMARY_ROUTE);
        const itemsMatch = request.method === 'GET' &&
          url.pathname.match(ITEMS_ROUTE);
        const itemDecisionMatch = request.method === 'PUT' &&
          rawPath.match(ITEM_DECISION_ROUTE);
        const ownerReviewMatch = request.method === 'GET' &&
          url.pathname.match(OWNER_REVIEW_ROUTE);
        const artifactsMatch = request.method === 'GET' &&
          url.pathname.match(ARTIFACTS_ROUTE);
        const artifactMatch = request.method === 'GET' &&
          rawPath.match(ARTIFACT_ROUTE);

        if (itemDecisionMatch) {
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
  ITEM_DECISION_ROUTE,
  ITEMS_ROUTE,
  OWNER_REVIEW_ROUTE,
  RUN_ROUTE,
  SUMMARY_ROUTE,
  createRouter,
  decodeItemId,
  queryObject,
};
