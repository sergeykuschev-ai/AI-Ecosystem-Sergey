const crypto = require('node:crypto');

const { HttpError, sendError, sendSuccess } = require('./responses');

const RUN_ROUTE = /^\/api\/v1\/runs\/([^/]+)$/;
const SUMMARY_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/summary$/;
const ITEMS_ROUTE = /^\/api\/v1\/runs\/([^/]+)\/items$/;
const OWNER_REVIEW_ROUTE =
  /^\/api\/v1\/runs\/([^/]+)\/owner-review$/;

function queryObject(searchParams) {
  const query = {};
  for (const [name, value] of searchParams) query[name] = value;
  return query;
}

function createRouter(handlers, options = {}) {
  const uuid = options.uuid || crypto.randomUUID;

  return async function route(request, response) {
    const requestId = uuid();
    let runId = null;
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      let result;

      if (request.method === 'POST' && url.pathname === '/api/v1/runs') {
        result = await handlers.createRun(request, { requestId });
      } else {
        const statusMatch = request.method === 'GET' &&
          url.pathname.match(RUN_ROUTE);
        const summaryMatch = request.method === 'GET' &&
          url.pathname.match(SUMMARY_ROUTE);
        const itemsMatch = request.method === 'GET' &&
          url.pathname.match(ITEMS_ROUTE);
        const ownerReviewMatch = request.method === 'GET' &&
          url.pathname.match(OWNER_REVIEW_ROUTE);

        if (summaryMatch) {
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
  ITEMS_ROUTE,
  OWNER_REVIEW_ROUTE,
  RUN_ROUTE,
  SUMMARY_ROUTE,
  createRouter,
  queryObject,
};
