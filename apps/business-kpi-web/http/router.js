'use strict';

const crypto = require('node:crypto');
const Busboy = require('busboy');

const { ApplicationError } = require('../application/application_error');
const { sendApiError, sendJson } = require('./responses');

const SHIFT_ROUTE = /^\/api\/business-kpi\/shifts\/([0-9a-f-]{36})$/i;
const PLAN_ROUTE = /^\/api\/business-kpi\/plans\/(\d{4})\/(\d{1,2})$/;
const IMPORT_COMMIT_ROUTE = /^\/api\/business-kpi\/imports\/([0-9a-f-]{36})\/commit$/i;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_XLSX_BYTES = 20 * 1024 * 1024;

async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      throw new ApplicationError(
        'REQUEST_TOO_LARGE',
        'JSON-запрос превышает допустимый размер.',
        413
      );
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    throw new ApplicationError(
      'INVALID_JSON',
      'Тело запроса должно быть корректным JSON.',
      400,
      { cause: error }
    );
  }
}

function actorFromRequest(request, devMode) {
  if (!devMode) {
    throw new ApplicationError(
      'AUTH_NOT_CONFIGURED',
      'Production-аутентификация Business KPI ещё не настроена.',
      503
    );
  }
  return {
    id: String(request.headers['x-business-kpi-actor-id'] || 'local-owner'),
    role: String(request.headers['x-business-kpi-role'] || 'OWNER').toUpperCase(),
  };
}

function positiveInteger(value, fieldName, options = {}) {
  if (value === null || value === undefined || value === '') {
    if (options.optional) return null;
    throw new ApplicationError(
      'VALIDATION_ERROR',
      `${fieldName} обязателен.`,
      422
    );
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < options.min || parsed > options.max) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      `${fieldName} содержит недопустимое значение.`,
      422
    );
  }
  return parsed;
}

function periodFromUrl(url) {
  const now = new Date();
  return {
    storeId: url.searchParams.get('store') || url.searchParams.get('store_id'),
    year: positiveInteger(
      url.searchParams.get('year') || now.getUTCFullYear(),
      'year',
      { min: 2000, max: 2200 }
    ),
    month: positiveInteger(
      url.searchParams.get('month') || now.getUTCMonth() + 1,
      'month',
      { min: 1, max: 12 }
    ),
  };
}

function optionalDate(value, fieldName) {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      `${fieldName} должен быть датой YYYY-MM-DD.`,
      422
    );
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      `${fieldName} содержит несуществующую дату.`,
      422
    );
  }
  return value;
}

function shiftFilters(url) {
  const filters = {
    storeId: url.searchParams.get('store') || null,
    employeeId: url.searchParams.get('employee') || null,
    year: positiveInteger(url.searchParams.get('year'), 'year', {
      min: 2000,
      max: 2200,
      optional: true,
    }),
    month: positiveInteger(url.searchParams.get('month'), 'month', {
      min: 1,
      max: 12,
      optional: true,
    }),
    dateFrom: optionalDate(url.searchParams.get('date_from'), 'date_from'),
    dateTo: optionalDate(url.searchParams.get('date_to'), 'date_to'),
  };
  if (filters.dateFrom && filters.dateTo && filters.dateFrom > filters.dateTo) {
    throw new ApplicationError(
      'VALIDATION_ERROR',
      'date_from не может быть позже date_to.',
      422
    );
  }
  return filters;
}

function success(response, data, statusCode = 200, headers = {}) {
  if (headers.location) response.setHeader('Location', headers.location);
  sendJson(response, statusCode, { api_version: 'v1', data });
}

function decodeUploadFilename(filename) {
  const decoded = Buffer.from(filename, 'latin1').toString('utf8');
  return decoded.includes('\uFFFD') ? filename : decoded;
}

function readXlsxMultipart(request) {
  return new Promise((resolve, reject) => {
    let parser;
    try {
      parser = Busboy({
        headers: request.headers,
        limits: { files: 1, fileSize: MAX_XLSX_BYTES, fields: 10 },
      });
    } catch (error) {
      reject(new ApplicationError('INVALID_MULTIPART', 'Ожидается multipart/form-data с XLSX-файлом.', 400, { cause: error }));
      return;
    }
    const fields = {};
    let filename = null;
    let chunks = [];
    let tooLarge = false;
    parser.on('field', (name, value) => { fields[name] = value; });
    parser.on('file', (name, stream, info) => {
      if (name !== 'file') {
        stream.resume();
        return;
      }
      filename = decodeUploadFilename(info.filename);
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('limit', () => { tooLarge = true; });
    });
    parser.on('error', error => reject(new ApplicationError('INVALID_MULTIPART', 'Не удалось прочитать загрузку.', 400, { cause: error })));
    parser.on('finish', () => {
      if (tooLarge) {
        reject(new ApplicationError('REQUEST_TOO_LARGE', 'XLSX превышает 20 МБ.', 413));
      } else if (!filename) {
        reject(new ApplicationError('MISSING_XLSX', 'Поле file с XLSX обязательно.', 422));
      } else {
        resolve({ filename, buffer: Buffer.concat(chunks), storeId: fields.storeId || fields.store_id });
      }
      chunks = [];
    });
    request.pipe(parser);
  });
}

function createRouter(options) {
  const {
    businessKpiService,
    workbookImportService,
    devMode,
    healthService,
    staticHandler,
  } = options;

  return async function route(request, response) {
    const requestId = crypto.randomUUID();
    let url;
    try {
      url = new URL(request.url, 'http://127.0.0.1');
    } catch {
      sendApiError(response, 400, 'INVALID_URL', 'Некорректный URL запроса.');
      return;
    }

    try {
      if (request.method === 'GET' &&
          (url.pathname === '/health' || url.pathname === '/api/v1/health')) {
        const health = await healthService.getHealth();
        success(response, health, health.status === 'ok' ? 200 : 503);
        return;
      }

      if (request.method === 'GET' &&
          url.pathname === '/api/business-kpi/reference-data') {
        success(
          response,
          await businessKpiService.getReferenceData(url.searchParams.get('store'))
        );
        return;
      }

      if (url.pathname === '/api/business-kpi/shifts') {
        if (request.method === 'GET') {
          success(response, {
            items: await businessKpiService.listShifts(shiftFilters(url)),
          });
          return;
        }
        if (request.method === 'POST') {
          const body = await readJson(request);
          const actor = actorFromRequest(request, devMode);
          const created = await businessKpiService.createShift(body, actor, {
            correlationId: requestId,
            reason: request.headers['x-change-reason'],
          });
          success(response, created, 201, {
            location: `/api/business-kpi/shifts/${created.id}`,
          });
          return;
        }
      }

      const shiftMatch = SHIFT_ROUTE.exec(url.pathname);
      if (shiftMatch) {
        const shiftId = shiftMatch[1];
        if (request.method === 'GET') {
          success(response, await businessKpiService.getShift(shiftId));
          return;
        }
        if (request.method === 'PATCH') {
          const actor = actorFromRequest(request, devMode);
          success(response, await businessKpiService.updateShift(
            shiftId,
            await readJson(request),
            actor,
            {
              correlationId: requestId,
              reason: request.headers['x-change-reason'],
            }
          ));
          return;
        }
        if (request.method === 'DELETE') {
          const actor = actorFromRequest(request, devMode);
          success(response, await businessKpiService.archiveShift(
            shiftId,
            actor,
            {
              correlationId: requestId,
              reason: request.headers['x-change-reason'],
            }
          ));
          return;
        }
      }

      if (request.method === 'GET' &&
          url.pathname === '/api/business-kpi/dashboard') {
        const period = periodFromUrl(url);
        if (!period.storeId) {
          throw new ApplicationError(
            'VALIDATION_ERROR',
            'store обязателен.',
            422
          );
        }
        success(response, await businessKpiService.getDashboard(period));
        return;
      }

      if (request.method === 'GET' &&
          url.pathname === '/api/business-kpi/sellers') {
        const period = periodFromUrl(url);
        if (!period.storeId) {
          throw new ApplicationError(
            'VALIDATION_ERROR',
            'store обязателен.',
            422
          );
        }
        const dashboard = await businessKpiService.getDashboard(period);
        success(response, {
          year: period.year,
          month: period.month,
          items: dashboard.sellers,
        });
        return;
      }

      if (url.pathname === '/api/business-kpi/imports') {
        if (request.method === 'GET') {
          success(response, await workbookImportService.list(url.searchParams.get('store')));
          return;
        }
      }

      if (request.method === 'POST' &&
          url.pathname === '/api/business-kpi/imports/dry-run') {
        const upload = await readXlsxMultipart(request);
        if (!upload.storeId) {
          throw new ApplicationError('VALIDATION_ERROR', 'storeId обязателен.', 422);
        }
        success(response, await workbookImportService.dryRun(
          upload,
          actorFromRequest(request, devMode)
        ), 201);
        return;
      }

      const importCommitMatch = IMPORT_COMMIT_ROUTE.exec(url.pathname);
      if (importCommitMatch && request.method === 'POST') {
        success(response, await workbookImportService.commit(
          importCommitMatch[1],
          actorFromRequest(request, devMode)
        ));
        return;
      }

      if (request.method === 'GET' &&
          url.pathname === '/api/business-kpi/export') {
        const selected = periodFromUrl(url);
        if (!selected.storeId) {
          throw new ApplicationError('VALIDATION_ERROR', 'store обязателен.', 422);
        }
        const workbook = await businessKpiService.exportMonth(selected);
        const filename = `business-kpi-${selected.year}-${String(selected.month).padStart(2, '0')}.xlsx`;
        response.writeHead(200, {
          'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': workbook.length,
        });
        response.end(workbook);
        return;
      }

      if (request.method === 'GET' &&
          url.pathname === '/api/business-kpi/settings') {
        const storeId = url.searchParams.get('store');
        const date = url.searchParams.get('date') ||
          new Date().toISOString().slice(0, 10);
        if (!storeId) {
          throw new ApplicationError('VALIDATION_ERROR', 'store обязателен.', 422);
        }
        success(response, await businessKpiService.getSettings(storeId, date));
        return;
      }

      const planMatch = PLAN_ROUTE.exec(url.pathname);
      if (planMatch && request.method === 'PUT') {
        const body = await readJson(request);
        const storeId = body.storeId || url.searchParams.get('store');
        if (!storeId) {
          throw new ApplicationError('VALIDATION_ERROR', 'storeId обязателен.', 422);
        }
        success(response, await businessKpiService.updateMonthlyPlan({
          storeId,
          year: positiveInteger(planMatch[1], 'year', { min: 2000, max: 2200 }),
          month: positiveInteger(planMatch[2], 'month', { min: 1, max: 12 }),
          revenuePlan: body.revenuePlan,
        }, actorFromRequest(request, devMode), {
          correlationId: requestId,
          reason: body.reason || request.headers['x-change-reason'],
        }));
        return;
      }

      if (request.method === 'GET' && !url.pathname.startsWith('/api/')) {
        if (staticHandler(url.pathname, response)) return;
      }

      throw new ApplicationError(
        'ROUTE_NOT_FOUND',
        url.pathname.startsWith('/api/')
          ? 'Запрошенный API endpoint не найден.'
          : 'Запрошенный ресурс не найден.',
        404
      );
    } catch (error) {
      if (error instanceof ApplicationError) {
        sendApiError(
          response,
          error.statusCode,
          error.code,
          error.message,
          error.details
        );
        return;
      }
      throw error;
    }
  };
}

module.exports = {
  MAX_JSON_BYTES,
  MAX_XLSX_BYTES,
  actorFromRequest,
  createRouter,
  decodeUploadFilename,
  optionalDate,
  periodFromUrl,
  positiveInteger,
  readJson,
  readXlsxMultipart,
  shiftFilters,
};
