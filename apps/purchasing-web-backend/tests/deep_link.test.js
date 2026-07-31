const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  createApplication,
  parseRunIdFromSearch,
  ERROR_MESSAGES,
} = require('../public/app.js');

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';

// --- Fake DOM (same pattern as decision_tabs_consistency.test.js) ----

function fakeAppElement(tagName = 'div') {
  return {
    tagName,
    children: [],
    className: '',
    dataset: {},
    attributes: {},
    listeners: {},
    hidden: false,
    textContent: '',
    disabled: false,
    value: '',
    checked: false,
    open: false,
    style: {},
    classList: {
      add() {},
      remove() {},
      toggle() {},
      contains: () => false,
    },
    append(...children) {
      this.children.push(...children);
    },
    prepend(...children) {
      this.children.unshift(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    replaceChildren(...children) {
      this.children = [...children];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    addEventListener(name, listener) {
      this.listeners[name] ||= [];
      this.listeners[name].push(listener);
    },
    removeEventListener() {},
    querySelector: () => fakeAppElement(),
    querySelectorAll: () => [],
    closest: () => fakeAppElement('th'),
    focus() {},
    click() {},
    close() {},
    showModal() {},
    show() {},
    remove() {},
    set innerHTML(value) {
      throw new Error(`Unsafe innerHTML assignment: ${value}`);
    },
  };
}

function fakeAppDocument(search = '') {
  const byId = new Map();
  const documentObject = {
    createElement: tagName => fakeAppElement(tagName),
    getElementById(id) {
      if (!byId.has(id)) byId.set(id, fakeAppElement());
      return byId.get(id);
    },
    querySelectorAll: () => [],
    addEventListener() {},
    body: fakeAppElement('body'),
    defaultView: { location: { search } },
  };
  return documentObject;
}

// --- Mock fetch --------------------------------------------------------

function runStatusPayload(status, extra = {}) {
  return {
    run_id: RUN_ID,
    status,
    links: {
      self: `/api/v1/runs/${RUN_ID}`,
      summary: `/api/v1/runs/${RUN_ID}/summary`,
      items: `/api/v1/runs/${RUN_ID}/items`,
      artifacts: `/api/v1/runs/${RUN_ID}/artifacts`,
      owner_review: `/api/v1/runs/${RUN_ID}/owner-review`,
    },
    ...extra,
  };
}

function okJson(data) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { data };
    },
  };
}

function errorJson(status, code) {
  return {
    ok: false,
    status,
    async json() {
      return { error: { code } };
    },
  };
}

function createMockFetch(options, requests) {
  let statusCalls = 0;
  return async (url, fetchOptions = {}) => {
    const method = fetchOptions.method || 'GET';
    requests.push({ url, method });
    if (url === `/api/v1/runs/${RUN_ID}`) {
      statusCalls += 1;
      const sequence = options.statusSequence || ['completed'];
      const status = sequence[Math.min(statusCalls - 1, sequence.length - 1)];
      if (status === 'not_found') {
        return errorJson(404, 'RUN_NOT_FOUND');
      }
      if (status === 'failed') {
        return okJson(runStatusPayload('failed', {
          error: { code: 'INVALID_WORKBOOK' },
        }));
      }
      return okJson(runStatusPayload(status));
    }
    if (url === `/api/v1/runs/${RUN_ID}/summary`) {
      return okJson({ run_id: RUN_ID, sku_count: 3 });
    }
    if (url === `/api/v1/runs/${RUN_ID}/artifacts`) {
      return okJson({ artifacts: [] });
    }
    if (url.startsWith(`/api/v1/runs/${RUN_ID}/items`)) {
      return okJson({
        items: [],
        pagination: {
          page: 1,
          page_size: 25,
          total_items: 0,
          total_pages: 0,
        },
        owner_decisions: {
          needs_decision: 0,
          confirmed: 0,
          confirmed_buy: 0,
          excluded: 0,
          deferred: 0,
        },
      });
    }
    if (url === `/api/v1/runs/${RUN_ID}/final-order`) {
      return errorJson(409, 'RUN_NOT_READY');
    }
    if (url === `/api/v1/runs/${RUN_ID}/supplier-order`) {
      return errorJson(409, 'RUN_NOT_READY');
    }
    // owner-learning center и прочие boot-запросы.
    return errorJson(404, 'ROUTE_NOT_FOUND');
  };
}

async function waitFor(assertion, attempts = 50) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      assertion();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
  assertion();
}

// --- ЭТАП 14 (deep link) ------------------------------------------------

test('parseRunIdFromSearch принимает только строгий UUID', () => {
  assert.equal(parseRunIdFromSearch(`?runId=${RUN_ID}`), RUN_ID);
  assert.equal(parseRunIdFromSearch(`runId=${RUN_ID}`), RUN_ID);
  assert.equal(
    parseRunIdFromSearch(`?runId=${RUN_ID}&other=1`),
    RUN_ID
  );
  assert.equal(parseRunIdFromSearch(''), null);
  assert.equal(parseRunIdFromSearch('?runId='), null);
  assert.equal(parseRunIdFromSearch('?other=1'), null);
  // Path traversal и произвольные значения отклоняются.
  assert.equal(parseRunIdFromSearch('?runId=../../etc/passwd'), null);
  assert.equal(parseRunIdFromSearch('?runId=<script>alert(1)</script>'), null);
  assert.equal(parseRunIdFromSearch('?runId=123'), null);
  assert.equal(
    parseRunIdFromSearch('?runId=123e4567-e89b-42d3-a456-42661417400g'),
    null
  );
  // Дублированный параметр не принимается.
  assert.equal(
    parseRunIdFromSearch(`?runId=${RUN_ID}&runId=${RUN_ID}`),
    null
  );
});

test('deep link: completed run открывается без повторной загрузки Excel', async () => {
  const requests = [];
  const documentObject = fakeAppDocument(`?runId=${RUN_ID}`);
  createApplication(documentObject, createMockFetch({}, requests));

  await waitFor(() => {
    assert.equal(
      documentObject.getElementById('status-pill').textContent,
      'Готово'
    );
  });
  // Первый запрос к runs API — статус run; POST /api/v1/runs не
  // выполнялся (Excel повторно не загружается).
  const runsRequests = requests.filter(r =>
    r.url.includes('/api/v1/runs/')
  );
  assert.equal(runsRequests[0].url, `/api/v1/runs/${RUN_ID}`);
  assert.equal(runsRequests[0].method, 'GET');
  assert.ok(
    !requests.some(r => r.method === 'POST'),
    'deep link не должен повторно загружать Excel'
  );
  // Загружены summary, artifacts и items — полный completed-pipeline.
  assert.ok(requests.some(r => r.url.endsWith('/summary')));
  assert.ok(requests.some(r => r.url.endsWith('/artifacts')));
  assert.ok(requests.some(r => r.url.includes('/items')));
});

test('deep link: processing run дожидается завершения через polling', async () => {
  const requests = [];
  const documentObject = fakeAppDocument(`?runId=${RUN_ID}`);
  createApplication(
    documentObject,
    createMockFetch({ statusSequence: ['processing', 'completed'] }, requests)
  );

  await waitFor(() => {
    assert.equal(
      documentObject.getElementById('status-pill').textContent,
      'Готово'
    );
  }, 100);
  const statusRequests = requests.filter(
    r => r.url === `/api/v1/runs/${RUN_ID}`
  );
  assert.ok(
    statusRequests.length >= 2,
    'статус запрашивался повторно до completed'
  );
});

test('deep link: failed run показывает состояние ошибки', async () => {
  const requests = [];
  const documentObject = fakeAppDocument(`?runId=${RUN_ID}`);
  createApplication(
    documentObject,
    createMockFetch({ statusSequence: ['failed'] }, requests)
  );

  await waitFor(() => {
    assert.equal(
      documentObject.getElementById('status-pill').textContent,
      'Ошибка'
    );
  });
  assert.equal(
    documentObject.getElementById('status-message').textContent,
    ERROR_MESSAGES.INVALID_WORKBOOK
  );
  // Summary для failed run не запрашивается.
  assert.ok(!requests.some(r => r.url.endsWith('/summary')));
});

test('deep link: неизвестный run показывает понятную ошибку', async () => {
  const requests = [];
  const documentObject = fakeAppDocument(`?runId=${RUN_ID}`);
  createApplication(
    documentObject,
    createMockFetch({ statusSequence: ['not_found'] }, requests)
  );

  await waitFor(() => {
    assert.equal(
      documentObject.getElementById('status-pill').textContent,
      'Ошибка'
    );
  });
  assert.equal(
    documentObject.getElementById('status-message').textContent,
    ERROR_MESSAGES.RUN_NOT_FOUND
  );
});

test('deep link: невалидный runId игнорируется, запросов нет', async () => {
  const requests = [];
  const documentObject = fakeAppDocument('?runId=../../etc/passwd');
  createApplication(documentObject, createMockFetch({}, requests));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(
    !requests.some(r => r.url.includes('/api/v1/runs/')),
    'невалидный runId не должен порождать API-запросы'
  );
});

test('без runId deep link не активируется', async () => {
  const requests = [];
  const documentObject = fakeAppDocument('');
  createApplication(documentObject, createMockFetch({}, requests));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.ok(
    !requests.some(r => r.url.includes('/api/v1/runs/')),
    'без runId не должно быть запросов к runs API при старте'
  );
});
