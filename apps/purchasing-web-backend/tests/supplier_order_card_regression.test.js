'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createApplication,
  downloadBlobFile,
  ERROR_MESSAGES,
  FrontendError,
  orderDownloadErrorMessage,
  requestFileDownload,
} = require('../public/app');

const RUN_ID = '55555555-5555-4555-8555-555555555555';
const SUPPLIER_ORDER_KEY = 'supplier-order';
const METADATA_URL = `/api/v1/runs/${RUN_ID}/supplier-order`;
const DOWNLOAD_URL = `/api/v1/runs/${RUN_ID}/supplier-order/download`;
const BLOCKED_MESSAGE =
  'Завершите ручную проверку всех позиций перед формированием заказа';

function availableMetadata(overrides = {}) {
  return {
    available: true,
    filename: 'Заказ_поставщику_Тест_31.07.2026.xlsx',
    mimeType:
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    downloadUrl: DOWNLOAD_URL,
    itemCount: 2,
    totalAmount: 200,
    blockedReason: null,
    ...overrides,
  };
}

function matchesSelector(element, selector) {
  if (selector.startsWith('.')) {
    return String(element.className || '')
      .split(/\s+/)
      .includes(selector.slice(1));
  }
  const attributeMatch = selector.match(/^\[([a-z-]+)="([^"]*)"\]$/i);
  if (attributeMatch) {
    const [, name, value] = attributeMatch;
    if (name.startsWith('data-')) {
      const datasetKey = name
        .slice(5)
        .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
      return element.dataset?.[datasetKey] === value;
    }
    return element.attributes?.[name] === value;
  }
  return false;
}

function queryTree(children, selector) {
  for (const child of children) {
    if (matchesSelector(child, selector)) return child;
    const nested = queryTree(child.children || [], selector);
    if (nested) return nested;
  }
  return null;
}

function fakeElement(tagName = 'div') {
  const element = {
    tagName,
    children: [],
    parent: null,
    className: '',
    dataset: {},
    attributes: {},
    listeners: {},
    hidden: false,
    textContent: '',
    disabled: false,
    value: '',
    clicked: false,
    append(...children) {
      for (const child of children) {
        child.parent = element;
        element.children.push(child);
      }
    },
    replaceChildren(...children) {
      for (const child of element.children) child.parent = null;
      element.children = [];
      element.append(...children);
    },
    setAttribute(name, value) {
      element.attributes[name] = String(value);
    },
    addEventListener(name, listener) {
      element.listeners[name] ||= [];
      element.listeners[name].push(listener);
    },
    remove() {
      if (!element.parent) return;
      const index = element.parent.children.indexOf(element);
      if (index >= 0) element.parent.children.splice(index, 1);
      element.parent = null;
    },
    contains(node) {
      let current = node;
      while (current) {
        if (current === element) return true;
        current = current.parent;
      }
      return false;
    },
    querySelector(selector) {
      return queryTree(element.children, selector);
    },
    closest() {
      return null;
    },
    showModal() {},
    close() {},
    click() {
      element.clicked = true;
    },
  };
  Object.defineProperty(element, 'innerHTML', {
    set() {
      throw new Error(`Unsafe innerHTML assignment: ${tagName}`);
    },
  });
  return element;
}

function createFakeDom() {
  const byId = new Map();
  const createdLinks = [];
  const browserState = {
    createdObjectUrls: [],
    revokedObjectUrls: [],
  };
  const body = fakeElement('body');
  const documentObject = {
    body,
    createElement(tagName) {
      const element = fakeElement(tagName);
      if (tagName === 'a') createdLinks.push(element);
      return element;
    },
    getElementById(id) {
      if (!byId.has(id)) {
        const element = fakeElement();
        element.id = id;
        byId.set(id, element);
      }
      return byId.get(id);
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
    defaultView: {
      Blob: class TestBlob {
        constructor(parts, options = {}) {
          this.parts = parts;
          this.type = options.type;
        }
      },
      URL: {
        createObjectURL(blob) {
          browserState.createdObjectUrls.push(blob);
          return `blob:supplier-order-${browserState.createdObjectUrls.length}`;
        },
        revokeObjectURL(url) {
          browserState.revokedObjectUrls.push(url);
        },
      },
      setTimeout(callback) {
        callback();
      },
    },
  };
  return { documentObject, body, createdLinks, browserState };
}

function runStatusPayload() {
  return {
    status: 'completed',
    run_id: RUN_ID,
    source: { original_name: 'synthetic.xlsx' },
    started_at: new Date(Date.now() - 5000).toISOString(),
    completed_at: new Date().toISOString(),
    links: {
      self: `/api/v1/runs/${RUN_ID}`,
      summary: `/api/v1/runs/${RUN_ID}/summary`,
      artifacts: `/api/v1/runs/${RUN_ID}/artifacts`,
      items: `/api/v1/runs/${RUN_ID}/items`,
    },
  };
}

function summaryPayload() {
  return {
    amounts: { working_maximum_sum: 200, working_maximum_lines: 2 },
    financial: { status: 'APPROVED', reserve_surplus: 100 },
    sku_count: 1,
    warnings: [],
    critical_issues: [],
    owner_review: { action_required: 1 },
  };
}

function itemsPayload() {
  return {
    items: [{
      row_id: 'row-1',
      name: 'Синтетический товар',
      sku: 'SKU-1',
      brand: 'TestBrand',
      stock: { free_stock: 3 },
      sales: { last_28_days: 5 },
      quantities: { approved_quantity: 2 },
      amounts: { unit_price: 100 },
      matrix: { owner_review_required: true },
    }],
    pagination: { page: 1, page_size: 25, total_items: 1, total_pages: 1 },
  };
}

function decisionSavePayload() {
  return {
    item: {
      owner_decision: {
        decision: 'BUY',
        quantity: 2,
        reason_code: 'LOW_DEMAND',
      },
    },
    owner_decisions: {
      pending_positive: 0,
      pending_zero: 0,
      postponed: 0,
      do_not_buy: 0,
      warnings: 0,
      safe_no_order: 0,
    },
  };
}

function jsonResponse(payload, ok = true) {
  return Promise.resolve({
    ok,
    status: ok ? 200 : 500,
    json: () => Promise.resolve(payload),
  });
}

function notFoundJson() {
  return jsonResponse({ error: true, code: 'ROUTE_NOT_FOUND' }, false);
}

async function flushAsyncWork(rounds = 4) {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function submitSyntheticRun(app, documentObject) {
  const fileInput = documentObject.getElementById('file-input');
  fileInput.files = [new File(
    ['xlsx'],
    'synthetic.xlsx',
    {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }
  )];
  app.updateFileSelection();
  await app.submitRun({ preventDefault: () => {} });
}

function reportGrid(documentObject) {
  return documentObject.getElementById('report-center-grid');
}

function findSupplierOrderCard(documentObject) {
  return reportGrid(documentObject)
    .querySelector(`[data-artifact-key="${SUPPLIER_ORDER_KEY}"]`);
}

async function saveFirstItemDecision(documentObject) {
  const productsBody = documentObject.getElementById('products-body');
  assert.ok(productsBody.children.length > 0, 'ожидался хотя бы один товар');
  const row = productsBody.children[0];
  const decisionCell = row.children[row.children.length - 1];
  const controls = decisionCell.children[1];
  const actionGroup = controls.children[1];
  const buyButton = actionGroup.children[0];
  assert.match(buyButton.className, /action-buy/);
  buyButton.listeners.click[0]();
  const learningFields = controls.children[2];
  const reasonSelect = learningFields.children[0];
  reasonSelect.value = 'LOW_DEMAND';
  const confirmButton = learningFields.children[2].children[0];
  await confirmButton.listeners.click[0]();
}

async function clickSupplierOrderDownload(documentObject) {
  const grid = reportGrid(documentObject);
  const downloadButton = fakeElement('button');
  downloadButton.dataset.artifactKey = SUPPLIER_ORDER_KEY;
  downloadButton.dataset.reportAction = 'download';
  grid.append(downloadButton);
  const click = grid.listeners.click[0];
  return click({
    target: { closest: () => downloadButton },
  });
}

test('requestFileDownload возвращает blob при успешном ответе', async () => {
  const blob = { type: 'application/vnd…sheet', size: 8 };
  const result = await requestFileDownload(
    () => Promise.resolve({
      ok: true,
      blob: () => Promise.resolve(blob),
    }),
    DOWNLOAD_URL
  );
  assert.equal(result, blob);
});

test('requestFileDownload извлекает код и сообщение из JSON-ошибки', async () => {
  await assert.rejects(
    requestFileDownload(
      () => jsonResponse({
        error: { code: 'OWNER_REVIEW_INCOMPLETE', message: BLOCKED_MESSAGE },
      }, false),
      DOWNLOAD_URL
    ),
    (error) => {
      assert.ok(error instanceof FrontendError);
      assert.equal(error.code, 'OWNER_REVIEW_INCOMPLETE');
      assert.equal(error.details, BLOCKED_MESSAGE);
      return true;
    }
  );

  await assert.rejects(
    requestFileDownload(
      () => jsonResponse({
        error: true,
        code: 'RUN_FAILED',
        message: 'расчёт не завершён',
      }, false),
      DOWNLOAD_URL
    ),
    (error) => {
      assert.ok(error instanceof FrontendError);
      assert.equal(error.code, 'RUN_FAILED');
      assert.equal(error.details, 'расчёт не завершён');
      return true;
    }
  );
});

test('requestFileDownload при сетевой ошибке и не-JSON ответе', async () => {
  await assert.rejects(
    requestFileDownload(
      () => Promise.reject(new Error('offline')),
      DOWNLOAD_URL
    ),
    (error) => {
      assert.ok(error instanceof FrontendError);
      assert.equal(error.code, 'NETWORK_ERROR');
      return true;
    }
  );

  await assert.rejects(
    requestFileDownload(
      () => Promise.resolve({
        ok: false,
        json: () => Promise.reject(new Error('not json')),
      }),
      DOWNLOAD_URL
    ),
    (error) => {
      assert.ok(error instanceof FrontendError);
      assert.equal(error.code, 'RUN_FAILED');
      assert.equal(error.details, '');
      return true;
    }
  );
});

test('orderDownloadErrorMessage предпочитает сообщение сервера', () => {
  assert.equal(
    orderDownloadErrorMessage(
      new FrontendError('OWNER_REVIEW_INCOMPLETE', BLOCKED_MESSAGE)
    ),
    BLOCKED_MESSAGE
  );
  assert.equal(
    orderDownloadErrorMessage(new FrontendError('NETWORK_ERROR')),
    ERROR_MESSAGES.NETWORK_ERROR
  );
  assert.equal(
    orderDownloadErrorMessage(new FrontendError('UNKNOWN_CODE_X')),
    ERROR_MESSAGES.RUN_FAILED
  );
  assert.equal(
    orderDownloadErrorMessage(new TypeError('boom')),
    ERROR_MESSAGES.RUN_FAILED
  );
});

test('downloadBlobFile сохраняет файл с заданным именем', () => {
  const { documentObject, createdLinks, browserState } = createFakeDom();
  const blob = { type: 'xlsx-bytes' };
  downloadBlobFile(
    blob,
    'Заказ_поставщику_Тест_31.07.2026.xlsx',
    documentObject,
    documentObject.defaultView
  );
  assert.equal(createdLinks.length, 1);
  const link = createdLinks[0];
  assert.equal(
    link.download,
    'Заказ_поставщику_Тест_31.07.2026.xlsx'
  );
  assert.equal(link.href, 'blob:supplier-order-1');
  assert.equal(link.clicked, true);
  assert.equal(link.parent, null, 'ссылка должна быть удалена из DOM');
  assert.equal(browserState.createdObjectUrls[0], blob);
  assert.deepEqual(browserState.revokedObjectUrls, ['blob:supplier-order-1']);
});

test('устаревшая карточка заказа очищается при ошибке обновления метаданных',
  async () => {
    let metadataCalls = 0;
    let metadataFailure = null;
    function mockFetch(url, options = {}) {
      if (url === '/api/v1/runs' && options.method === 'POST') {
        return jsonResponse({ data: runStatusPayload() });
      }
      if (url.endsWith('/summary')) return jsonResponse({ data: summaryPayload() });
      if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } });
      if (url.includes('/items/') && options.method === 'PUT') {
        return jsonResponse({ data: decisionSavePayload() });
      }
      if (url.endsWith('/final-order')) return jsonResponse({ data: null });
      if (url === METADATA_URL) {
        metadataCalls += 1;
        if (metadataFailure) return metadataFailure();
        return jsonResponse({ data: availableMetadata() });
      }
      if (url.startsWith(`/api/v1/runs/${RUN_ID}/items?`)) {
        return jsonResponse({ data: itemsPayload() });
      }
      return notFoundJson();
    }

    const { documentObject } = createFakeDom();
    const app = createApplication(documentObject, mockFetch);
    await submitSyntheticRun(app, documentObject);

    assert.ok(
      findSupplierOrderCard(documentObject),
      'карточка заказа должна появиться после расчёта'
    );
    assert.equal(metadataCalls, 1);

    metadataFailure = () => jsonResponse(
      { error: { code: 'RUN_FAILED', message: 'метаданные недоступны' } },
      false
    );
    await saveFirstItemDecision(documentObject);
    await flushAsyncWork();

    assert.equal(
      findSupplierOrderCard(documentObject),
      null,
      'при ошибке обновления метаданных устаревшая карточка должна исчезнуть'
    );
    assert.equal(reportGrid(documentObject).hidden, true);
    assert.equal(
      documentObject.getElementById('report-center-empty').hidden,
      false
    );
    assert.ok(metadataCalls >= 2, 'метаданные должны быть запрошены повторно');
  }
);

test('карточка заказа сохраняется, если метаданные обновились успешно',
  async () => {
    function mockFetch(url, options = {}) {
      if (url === '/api/v1/runs' && options.method === 'POST') {
        return jsonResponse({ data: runStatusPayload() });
      }
      if (url.endsWith('/summary')) return jsonResponse({ data: summaryPayload() });
      if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } });
      if (url.includes('/items/') && options.method === 'PUT') {
        return jsonResponse({ data: decisionSavePayload() });
      }
      if (url.endsWith('/final-order')) return jsonResponse({ data: null });
      if (url === METADATA_URL) {
        return jsonResponse({ data: availableMetadata() });
      }
      if (url.startsWith(`/api/v1/runs/${RUN_ID}/items?`)) {
        return jsonResponse({ data: itemsPayload() });
      }
      return notFoundJson();
    }

    const { documentObject } = createFakeDom();
    const app = createApplication(documentObject, mockFetch);
    await submitSyntheticRun(app, documentObject);
    assert.ok(findSupplierOrderCard(documentObject));

    await saveFirstItemDecision(documentObject);
    await flushAsyncWork();

    assert.ok(
      findSupplierOrderCard(documentObject),
      'карточка заказа должна остаться после успешного обновления'
    );
  }
);

test('скачивание заказа показывает JSON-ошибку сервера на карточке',
  async () => {
    function mockFetch(url, options = {}) {
      if (url === '/api/v1/runs' && options.method === 'POST') {
        return jsonResponse({ data: runStatusPayload() });
      }
      if (url.endsWith('/summary')) return jsonResponse({ data: summaryPayload() });
      if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } });
      if (url.endsWith('/final-order')) return jsonResponse({ data: null });
      if (url === METADATA_URL) {
        return jsonResponse({ data: availableMetadata() });
      }
      if (url === DOWNLOAD_URL) {
        assert.equal(options.method, undefined);
        return jsonResponse({
          error: { code: 'OWNER_REVIEW_INCOMPLETE', message: BLOCKED_MESSAGE },
        }, false);
      }
      if (url.startsWith(`/api/v1/runs/${RUN_ID}/items?`)) {
        return jsonResponse({ data: itemsPayload() });
      }
      return notFoundJson();
    }

    const { documentObject, body } = createFakeDom();
    const app = createApplication(documentObject, mockFetch);
    await submitSyntheticRun(app, documentObject);
    const card = findSupplierOrderCard(documentObject);
    assert.ok(card, 'карточка заказа должна быть показана');

    await clickSupplierOrderDownload(documentObject);
    await flushAsyncWork();

    const errorLine = card.querySelector('.report-card-error');
    assert.ok(
      errorLine,
      'карточка должна содержать элемент для сообщения об ошибке'
    );
    assert.equal(errorLine.hidden, false);
    assert.equal(errorLine.textContent, BLOCKED_MESSAGE);
    assert.equal(
      body.children.length,
      0,
      'при ошибке скачивания файл не должен сохраняться'
    );
  }
);

test('скачивание заказа без ошибок сохраняет файл с именем из метаданных',
  async () => {
    const orderBlob = { type: 'xlsx-bytes' };
    function mockFetch(url, options = {}) {
      if (url === '/api/v1/runs' && options.method === 'POST') {
        return jsonResponse({ data: runStatusPayload() });
      }
      if (url.endsWith('/summary')) return jsonResponse({ data: summaryPayload() });
      if (url.endsWith('/artifacts')) return jsonResponse({ data: { artifacts: [] } });
      if (url.endsWith('/final-order')) return jsonResponse({ data: null });
      if (url === METADATA_URL) {
        return jsonResponse({ data: availableMetadata() });
      }
      if (url === DOWNLOAD_URL) {
        return Promise.resolve({
          ok: true,
          blob: () => Promise.resolve(orderBlob),
        });
      }
      if (url.startsWith(`/api/v1/runs/${RUN_ID}/items?`)) {
        return jsonResponse({ data: itemsPayload() });
      }
      return notFoundJson();
    }

    const { documentObject, createdLinks, browserState } = createFakeDom();
    const app = createApplication(documentObject, mockFetch);
    await submitSyntheticRun(app, documentObject);
    const card = findSupplierOrderCard(documentObject);
    assert.ok(card);

    await clickSupplierOrderDownload(documentObject);
    await flushAsyncWork();

    assert.equal(createdLinks.length, 1);
    assert.equal(
      createdLinks[0].download,
      'Заказ_поставщику_Тест_31.07.2026.xlsx'
    );
    assert.equal(createdLinks[0].clicked, true);
    assert.deepEqual(browserState.createdObjectUrls, [orderBlob]);
    const errorLine = card.querySelector('.report-card-error');
    assert.ok(errorLine);
    assert.equal(errorLine.hidden, true);
    assert.equal(errorLine.textContent, '');
  }
);
