(function initializePurchasingFrontend(globalObject) {
  'use strict';

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const POLL_INTERVAL_MS = 1000;
  const POLL_TIMEOUT_MS = 10 * 60 * 1000;
  const ALLOWED_FILE_PATTERN = /\.(xlsx|xls)$/i;
  const RUN_LINK_PATTERN =
    /^\/api\/v1\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/(?:summary|artifacts|items))?$/i;
  const ARTIFACT_LINK_PATTERN =
    /^\/api\/v1\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/artifacts\/[a-z0-9.-]+$/i;

  const ARTIFACTS = Object.freeze({
    result: Object.freeze({
      name: 'result.json',
      pathSuffix: '/artifacts/result.json',
    }),
    report: Object.freeze({
      name: 'report.txt',
      pathSuffix: '/artifacts/report.txt',
    }),
    'owner-review': Object.freeze({
      name: 'owner-review-report.md',
      pathSuffix: '/artifacts/owner-review-report.md',
    }),
    explanations: Object.freeze({
      name: 'recommendation-explanations-report.md',
      pathSuffix: '/artifacts/recommendation-explanations-report.md',
    }),
  });
  const ITEM_FILTERS = Object.freeze({
    all: Object.freeze({}),
    buy: Object.freeze({ positive_order: 'true' }),
    'do-not-buy': Object.freeze({ decision: 'do_not_buy' }),
    'owner-review': Object.freeze({ owner_review: 'true' }),
    'auto-approved': Object.freeze({
      workflow_status: 'auto_approved',
    }),
    'pending-review': Object.freeze({
      workflow_status: 'pending_manual_review',
    }),
  });
  const ITEM_SORTS = Object.freeze([
    'source_row',
    'name',
    'recommended_quantity',
    'recommended_line_value',
    'free_stock',
    'sales_28_days',
  ]);

  const ERROR_MESSAGES = Object.freeze({
    FILE_REQUIRED: 'Выберите Excel-файл.',
    INVALID_FILE: 'Выберите файл в формате .xlsx или .xls.',
    UPLOAD_TOO_LARGE: 'Файл превышает допустимый размер 20 МБ.',
    UNSUPPORTED_FILE_TYPE: 'Формат файла не поддерживается.',
    INVALID_WORKBOOK:
      'Не удалось прочитать отчёт. Проверьте файл SmartZapas и повторите.',
    INPUT_CONTRACT_ERROR:
      'В отчёте не хватает обязательных данных для расчёта.',
    RUN_ALREADY_IN_PROGRESS:
      'Другой расчёт уже выполняется. Повторите запуск немного позже.',
    RUN_FAILED: 'Расчёт не завершён. Проверьте файл и попробуйте снова.',
    POLL_TIMEOUT:
      'Расчёт занимает больше 10 минут. Попробуйте повторить позже.',
    NETWORK_ERROR:
      'Нет связи с локальным сервером. Проверьте, что он запущен.',
  });

  class FrontendError extends Error {
    constructor(code) {
      super(code);
      this.name = 'FrontendError';
      this.code = code;
    }
  }

  function formatRub(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function displayCount(value) {
    return Number.isInteger(value)
      ? new Intl.NumberFormat('ru-RU').format(value)
      : '—';
  }

  function formatQuantity(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    return new Intl.NumberFormat('ru-RU', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(value);
  }

  function recommendedQuantity(item) {
    return item?.quantities?.approved_quantity ??
      item?.quantities?.provisional_quantity ??
      item?.quantities?.calculated_quantity ??
      null;
  }

  function recommendedLineValue(item) {
    return item?.amounts?.approved_line_value ??
      item?.amounts?.provisional_line_value ??
      null;
  }

  function itemStatusView(item) {
    const statuses = {
      auto_approved: ['Автоодобрено', 'status-auto'],
      pending_manual_review: ['Ожидает проверки', 'status-pending'],
      no_order_action: ['Не покупать', 'status-skip'],
      confidently_excluded: ['Не покупать', 'status-skip'],
      postponed: ['Отложено', 'status-skip'],
    };
    const exact = statuses[item?.workflow_status];
    if (exact) return { label: exact[0], className: exact[1] };
    if (['must_buy', 'recommended'].includes(item?.decision)) {
      return { label: 'Купить', className: 'status-buy' };
    }
    if (item?.decision === 'do_not_buy') {
      return { label: 'Не покупать', className: 'status-skip' };
    }
    if (item?.decision === 'manual_review') {
      return { label: 'На проверке', className: 'status-pending' };
    }
    return { label: 'Без решения', className: 'status-skip' };
  }

  function buildItemsUrl(baseUrl, state = {}) {
    const safeBase = safeRunLink(baseUrl);
    if (!safeBase || !safeBase.endsWith('/items')) {
      throw new FrontendError('RUN_FAILED');
    }
    const page = Number.isInteger(state.page) && state.page > 0
      ? state.page
      : 1;
    const pageSize = [25, 50, 100].includes(state.pageSize)
      ? state.pageSize
      : 25;
    const sort = ITEM_SORTS.includes(state.sort)
      ? state.sort
      : 'source_row';
    const order = state.order === 'desc' ? 'desc' : 'asc';
    const filter = ITEM_FILTERS[state.filter] || ITEM_FILTERS.all;
    const parameters = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort,
      order,
      ...filter,
    });
    const query = typeof state.q === 'string' ? state.q.trim() : '';
    if (query) parameters.set('q', query.slice(0, 100));
    return `${safeBase}?${parameters.toString()}`;
  }

  function paginationLabel(pagination = {}) {
    const total = Number.isInteger(pagination.total_items)
      ? pagination.total_items
      : 0;
    if (total === 0) return 'Показано 0 из 0';
    const page = Number.isInteger(pagination.page) ? pagination.page : 1;
    const pageSize = Number.isInteger(pagination.page_size)
      ? pagination.page_size
      : 25;
    const start = (page - 1) * pageSize + 1;
    const end = Math.min(page * pageSize, total);
    return `Показано ${start}–${end} из ${total}`;
  }

  function appendTextCell(documentObject, row, text, className = '') {
    const cell = documentObject.createElement('td');
    if (className) cell.className = className;
    cell.textContent = text;
    row.append(cell);
    return cell;
  }

  function createItemRow(documentObject, item) {
    const row = documentObject.createElement('tr');
    const nameCell = documentObject.createElement('td');
    const name = documentObject.createElement('strong');
    name.className = 'product-name';
    name.textContent = item?.name || 'Без названия';
    const sku = documentObject.createElement('span');
    sku.className = 'product-sku';
    sku.textContent = item?.sku ? `Артикул: ${item.sku}` : 'Артикул не указан';
    nameCell.append(name, sku);
    row.append(nameCell);

    appendTextCell(
      documentObject,
      row,
      item?.supplier || '—',
      'product-brand'
    );
    appendTextCell(
      documentObject,
      row,
      formatQuantity(item?.stock?.free_stock),
      'numeric-cell'
    );
    appendTextCell(
      documentObject,
      row,
      formatQuantity(item?.sales?.last_28_days),
      'numeric-cell'
    );
    appendTextCell(
      documentObject,
      row,
      formatQuantity(recommendedQuantity(item)),
      'numeric-cell'
    );
    appendTextCell(
      documentObject,
      row,
      formatRub(item?.amounts?.unit_price),
      'numeric-cell'
    );
    appendTextCell(
      documentObject,
      row,
      formatRub(recommendedLineValue(item)),
      'numeric-cell'
    );

    const statusCell = documentObject.createElement('td');
    const statusBadge = documentObject.createElement('span');
    const status = itemStatusView(item);
    statusBadge.className = `table-badge ${status.className}`;
    statusBadge.textContent = status.label;
    statusCell.append(statusBadge);
    row.append(statusCell);

    const ownerCell = documentObject.createElement('td');
    if (item?.matrix?.owner_review_required === true) {
      const ownerBadge = documentObject.createElement('span');
      ownerBadge.className = 'table-badge owner-review';
      ownerBadge.textContent = 'Требуется';
      ownerCell.append(ownerBadge);
    } else {
      const ownerEmpty = documentObject.createElement('span');
      ownerEmpty.className = 'owner-review-empty';
      ownerEmpty.textContent = 'Нет';
      ownerCell.append(ownerEmpty);
    }
    row.append(ownerCell);

    appendTextCell(
      documentObject,
      row,
      item?.explanation?.summary || 'Причина не указана',
      'reason-text'
    );
    return row;
  }

  function renderItemRows(documentObject, body, items) {
    body.replaceChildren();
    for (const item of Array.isArray(items) ? items : []) {
      body.append(createItemRow(documentObject, item));
    }
  }

  function setProductsPanelState(elements, state) {
    elements.products.hidden = state === 'hidden';
    elements.productsLoading.hidden = state !== 'loading';
    elements.productsError.hidden = state !== 'error';
    elements.productsEmpty.hidden = state !== 'empty';
    elements.productsContent.hidden = state !== 'ready';
  }

  function formatDuration(startedAt, completedAt) {
    const started = Date.parse(startedAt);
    const completed = Date.parse(completedAt);
    if (!Number.isFinite(started) || !Number.isFinite(completed)) return '—';
    const seconds = Math.max(0, Math.round((completed - started) / 1000));
    if (seconds < 60) return `${seconds} сек`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes} мин ${seconds % 60} сек`;
  }

  function financialStatusLabel(status) {
    const labels = {
      green: '🟢 Достаточный резерв',
      yellow: '🟠 Требуется внимание',
      red: '🔴 Требуется решение владельца',
      approved: '🟢 Одобрено',
      review: '🟠 Требуется проверка',
    };
    return labels[String(status || '').toLowerCase()] || 'Не указан';
  }

  function summaryView(summary, status) {
    const amounts = summary?.amounts || {};
    return {
      skuCount: displayCount(summary?.sku_count),
      analyzerOrderSum: formatRub(amounts.analyzer_order_sum),
      autoApprovedSum: formatRub(amounts.auto_approved_sum),
      pendingReviewSum: formatRub(amounts.pending_review_sum),
      workingMaximumSum: formatRub(amounts.working_maximum_sum),
      financiallyAssessedSum: formatRub(
        amounts.financially_assessed_sum
      ),
      financialStatus: financialStatusLabel(summary?.financial?.status),
      ownerReviewCount: displayCount(
        summary?.owner_review?.action_required
      ),
      calculationTime: formatDuration(
        status?.started_at,
        status?.completed_at
      ),
    };
  }

  function safeRunLink(value) {
    return typeof value === 'string' &&
      RUN_LINK_PATTERN.test(value) &&
      !value.includes('..') &&
      !value.includes('\\')
      ? value
      : null;
  }

  function safeArtifactDownloadUrl(value, definition) {
    if (
      typeof value !== 'string' ||
      !ARTIFACT_LINK_PATTERN.test(value)
    ) {
      return null;
    }
    if (value.includes('..') || value.includes('\\') || value.includes('\0')) {
      return null;
    }
    return value.endsWith(definition.pathSuffix) ? value : null;
  }

  function selectArtifacts(manifest) {
    const entries = Array.isArray(manifest?.artifacts)
      ? manifest.artifacts
      : [];
    const selected = {};
    for (const [key, definition] of Object.entries(ARTIFACTS)) {
      const entry = entries.find(item =>
        item?.name === definition.name &&
        safeArtifactDownloadUrl(item.download_url, definition)
      );
      if (entry) {
        selected[key] = {
          name: definition.name,
          downloadUrl: entry.download_url,
        };
      }
    }
    return selected;
  }

  async function requestJson(fetchFunction, url, options) {
    let response;
    try {
      response = await fetchFunction(url, options);
    } catch {
      throw new FrontendError('NETWORK_ERROR');
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new FrontendError('RUN_FAILED');
    }
    if (!response.ok) {
      throw new FrontendError(payload?.error?.code || 'RUN_FAILED');
    }
    return payload?.data;
  }

  async function pollRunStatus(options) {
    const {
      fetchFunction,
      statusUrl,
      onStatus = () => {},
      intervalMs = POLL_INTERVAL_MS,
      timeoutMs = POLL_TIMEOUT_MS,
      now = Date.now,
      sleep = delay => new Promise(resolve => setTimeout(resolve, delay)),
    } = options;
    const startedAt = now();

    while (now() - startedAt < timeoutMs) {
      const status = await requestJson(fetchFunction, statusUrl);
      onStatus(status);
      if (status?.status === 'completed') return status;
      if (status?.status === 'failed') {
        throw new FrontendError(status.error?.code || 'RUN_FAILED');
      }
      await sleep(intervalMs);
    }
    throw new FrontendError('POLL_TIMEOUT');
  }

  function createApplication(documentObject, fetchFunction) {
    const elements = {
      form: documentObject.getElementById('run-form'),
      fileInput: documentObject.getElementById('file-input'),
      fileError: documentObject.getElementById('file-error'),
      selectedFile: documentObject.getElementById('selected-file'),
      selectedFileName: documentObject.getElementById('selected-file-name'),
      runButton: documentObject.getElementById('run-button'),
      statusPill: documentObject.getElementById('status-pill'),
      statusMessage: documentObject.getElementById('status-message'),
      statusSteps: Array.from(
        documentObject.querySelectorAll('#status-list li')
      ),
      results: documentObject.getElementById('results'),
      exportButton: documentObject.getElementById('export-button'),
      exportMenu: documentObject.getElementById('export-menu'),
      calculationTime: documentObject.getElementById('calculation-time'),
      products: documentObject.getElementById('products'),
      productsSearch: documentObject.getElementById('products-search'),
      productFilters: Array.from(
        documentObject.querySelectorAll('[data-filter]')
      ),
      productsLoading: documentObject.getElementById('products-loading'),
      productsError: documentObject.getElementById('products-error'),
      productsEmpty: documentObject.getElementById('products-empty'),
      productsContent: documentObject.getElementById('products-content'),
      productsBody: documentObject.getElementById('products-body'),
      productsPageSize:
        documentObject.getElementById('products-page-size'),
      productsRange: documentObject.getElementById('products-range'),
      productsPrevious:
        documentObject.getElementById('products-previous'),
      productsNext: documentObject.getElementById('products-next'),
      sortButtons: Array.from(
        documentObject.querySelectorAll('[data-sort]')
      ),
      summary: {
        skuCount: documentObject.getElementById('sku-count'),
        analyzerOrderSum:
          documentObject.getElementById('analyzer-order-sum'),
        autoApprovedSum:
          documentObject.getElementById('auto-approved-sum'),
        pendingReviewSum:
          documentObject.getElementById('pending-review-sum'),
        workingMaximumSum:
          documentObject.getElementById('working-maximum-sum'),
        financiallyAssessedSum:
          documentObject.getElementById('financially-assessed-sum'),
        financialStatus:
          documentObject.getElementById('financial-status'),
        ownerReviewCount:
          documentObject.getElementById('owner-review-count'),
      },
    };

    let selectedFile = null;
    let active = false;
    let availableArtifacts = {};
    let itemRequestSequence = 0;
    let searchTimer = null;
    const itemState = {
      baseUrl: null,
      page: 1,
      pageSize: 25,
      q: '',
      filter: 'all',
      sort: 'source_row',
      order: 'asc',
      totalPages: 0,
    };

    function setExportOpen(open) {
      const shouldOpen = open && !elements.exportButton.disabled;
      elements.exportButton.setAttribute(
        'aria-expanded',
        String(shouldOpen)
      );
      elements.exportMenu.hidden = !shouldOpen;
    }

    function resetExports() {
      availableArtifacts = {};
      setExportOpen(false);
      elements.exportButton.disabled = true;
      for (const button of documentObject.querySelectorAll(
        '[data-artifact-key]'
      )) {
        button.disabled = true;
      }
    }

    function syncFilterControls() {
      for (const button of elements.productFilters) {
        button.setAttribute(
          'aria-pressed',
          String(button.dataset.filter === itemState.filter)
        );
      }
    }

    function syncSortControls() {
      for (const button of elements.sortButtons) {
        const heading = button.closest('th');
        const activeSort = button.dataset.sort === itemState.sort;
        heading.setAttribute(
          'aria-sort',
          activeSort
            ? (itemState.order === 'desc' ? 'descending' : 'ascending')
            : 'none'
        );
      }
    }

    function resetItems() {
      itemRequestSequence += 1;
      if (searchTimer) clearTimeout(searchTimer);
      Object.assign(itemState, {
        baseUrl: null,
        page: 1,
        pageSize: 25,
        q: '',
        filter: 'all',
        sort: 'source_row',
        order: 'asc',
        totalPages: 0,
      });
      elements.productsSearch.value = '';
      elements.productsPageSize.value = '25';
      elements.productsRange.textContent = 'Показано 0 из 0';
      elements.productsPrevious.disabled = true;
      elements.productsNext.disabled = true;
      renderItemRows(documentObject, elements.productsBody, []);
      syncFilterControls();
      syncSortControls();
      setProductsPanelState(elements, 'hidden');
    }

    function renderItemsPayload(payload) {
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const pagination = payload?.pagination || {};
      itemState.page = Number.isInteger(pagination.page)
        ? pagination.page
        : itemState.page;
      itemState.totalPages = Number.isInteger(pagination.total_pages)
        ? pagination.total_pages
        : 0;
      renderItemRows(documentObject, elements.productsBody, items);
      elements.productsRange.textContent = paginationLabel(pagination);
      elements.productsPrevious.disabled = itemState.page <= 1;
      elements.productsNext.disabled =
        itemState.totalPages === 0 ||
        itemState.page >= itemState.totalPages;
      setProductsPanelState(
        elements,
        items.length === 0 ? 'empty' : 'ready'
      );
    }

    async function loadItems() {
      if (!itemState.baseUrl) return;
      const sequence = ++itemRequestSequence;
      setProductsPanelState(elements, 'loading');
      try {
        const payload = await requestJson(
          fetchFunction,
          buildItemsUrl(itemState.baseUrl, itemState)
        );
        if (sequence !== itemRequestSequence) return;
        renderItemsPayload(payload);
      } catch {
        if (sequence !== itemRequestSequence) return;
        setProductsPanelState(elements, 'error');
      }
    }

    function activateItems(itemsUrl) {
      resetItems();
      itemState.baseUrl = itemsUrl;
      setProductsPanelState(elements, 'loading');
      return loadItems();
    }

    function setFieldError(message) {
      elements.fileError.textContent = message || '';
      elements.fileError.hidden = !message;
    }

    function renderStatus(state, message) {
      const order = ['selected', 'uploading', 'processing', 'completed'];
      const currentIndex = order.indexOf(state);
      for (const step of elements.statusSteps) {
        const stepState = step.dataset.state;
        const stepIndex = order.indexOf(stepState);
        step.classList.toggle('is-current', stepState === state);
        step.classList.toggle(
          'is-complete',
          state !== 'failed' &&
            stepIndex >= 0 &&
            stepIndex < currentIndex
        );
        step.classList.toggle(
          'is-error',
          state === 'failed' && stepState === 'failed'
        );
      }

      const pillSettings = {
        selected: ['Файл выбран', 'success'],
        uploading: ['Загрузка', 'active'],
        processing: ['Расчёт', 'active'],
        completed: ['Готово', 'success'],
        failed: ['Ошибка', 'error'],
      };
      const settings = pillSettings[state] || ['Ожидание', ''];
      elements.statusPill.textContent = settings[0];
      elements.statusPill.dataset.tone = settings[1];
      elements.statusMessage.textContent = message;
    }

    function validateFile(file) {
      if (!file) return 'FILE_REQUIRED';
      if (!ALLOWED_FILE_PATTERN.test(file.name || '')) return 'INVALID_FILE';
      if (file.size > MAX_FILE_BYTES) return 'UPLOAD_TOO_LARGE';
      return null;
    }

    function updateFileSelection() {
      const file = elements.fileInput.files?.[0] || null;
      const code = validateFile(file);
      selectedFile = code ? null : file;
      resetExports();
      resetItems();
      elements.results.hidden = true;
      elements.selectedFile.hidden = !file;
      elements.selectedFileName.textContent = file?.name || '';
      elements.runButton.disabled = !selectedFile || active;
      setFieldError(code ? ERROR_MESSAGES[code] : '');
      if (selectedFile) {
        renderStatus(
          'selected',
          'Файл готов к загрузке. Запустите расчёт.'
        );
      } else if (file) {
        renderStatus('failed', ERROR_MESSAGES[code]);
      }
    }

    function renderSummary(summary, status) {
      const view = summaryView(summary, status);
      for (const [name, element] of Object.entries(elements.summary)) {
        element.textContent = view[name];
      }
      elements.calculationTime.textContent =
        `Время расчёта: ${view.calculationTime}`;
      elements.results.hidden = false;
    }

    function configureDownloads(manifest) {
      availableArtifacts = selectArtifacts(manifest);
      const buttons = documentObject.querySelectorAll(
        '[data-artifact-key]'
      );
      for (const button of buttons) {
        button.disabled = !availableArtifacts[button.dataset.artifactKey];
      }
      elements.exportButton.disabled =
        Object.keys(availableArtifacts).length === 0;
    }

    async function submitRun(event) {
      event.preventDefault();
      if (active) return;
      const code = validateFile(selectedFile);
      if (code) {
        setFieldError(ERROR_MESSAGES[code]);
        return;
      }

      active = true;
      elements.runButton.disabled = true;
      setFieldError('');
      elements.results.hidden = true;
      resetExports();
      resetItems();
      renderStatus('uploading', 'Отчёт загружается на локальный сервер.');
      const processingHint = setTimeout(() => {
        if (active) {
          renderStatus(
            'processing',
            'Агент анализирует данные и формирует рекомендации.'
          );
        }
      }, 250);

      try {
        const formData = new FormData();
        formData.append('file', selectedFile, selectedFile.name);
        let status = await requestJson(fetchFunction, '/api/v1/runs', {
          method: 'POST',
          body: formData,
        });
        clearTimeout(processingHint);

        if (status?.status !== 'completed') {
          const statusUrl = safeRunLink(status?.links?.self);
          if (!statusUrl) throw new FrontendError('RUN_FAILED');
          renderStatus(
            'processing',
            'Агент анализирует данные и формирует рекомендации.'
          );
          status = await pollRunStatus({
            fetchFunction,
            statusUrl,
            onStatus: current => {
              if (current?.status === 'processing') {
                renderStatus(
                  'processing',
                  'Расчёт выполняется. Не закрывайте эту страницу.'
                );
              }
            },
          });
        }

        const summaryUrl = safeRunLink(status?.links?.summary);
        const artifactsUrl = safeRunLink(status?.links?.artifacts);
        const itemsUrl = safeRunLink(status?.links?.items);
        if (!summaryUrl || !artifactsUrl || !itemsUrl) {
          throw new FrontendError('RUN_FAILED');
        }
        const [summary, manifest] = await Promise.all([
          requestJson(fetchFunction, summaryUrl),
          requestJson(fetchFunction, artifactsUrl),
        ]);
        renderSummary(summary, status);
        configureDownloads(manifest);
        renderStatus(
          'completed',
          'Расчёт завершён. Итоги и файлы готовы.'
        );
        await activateItems(itemsUrl);
      } catch (error) {
        clearTimeout(processingHint);
        const codeValue = error instanceof FrontendError
          ? error.code
          : 'RUN_FAILED';
        renderStatus(
          'failed',
          ERROR_MESSAGES[codeValue] || ERROR_MESSAGES.RUN_FAILED
        );
      } finally {
        active = false;
        elements.runButton.disabled = !selectedFile;
      }
    }

    function downloadArtifact(event) {
      const key = event.currentTarget.dataset.artifactKey;
      const artifact = availableArtifacts[key];
      if (!artifact) return;
      setExportOpen(false);
      const link = documentObject.createElement('a');
      link.href = artifact.downloadUrl;
      link.download = artifact.name;
      link.rel = 'noopener';
      documentObject.body.append(link);
      link.click();
      link.remove();
    }

    function selectFilter(event) {
      itemState.filter = event.currentTarget.dataset.filter;
      itemState.page = 1;
      syncFilterControls();
      loadItems();
    }

    function selectSort(event) {
      const sort = event.currentTarget.dataset.sort;
      if (!ITEM_SORTS.includes(sort)) return;
      if (itemState.sort === sort) {
        itemState.order = itemState.order === 'asc' ? 'desc' : 'asc';
      } else {
        itemState.sort = sort;
        itemState.order = sort === 'name' ? 'asc' : 'desc';
      }
      itemState.page = 1;
      syncSortControls();
      loadItems();
    }

    elements.fileInput.addEventListener('change', updateFileSelection);
    elements.form.addEventListener('submit', submitRun);
    elements.exportButton.addEventListener('click', () => {
      setExportOpen(elements.exportMenu.hidden);
    });
    documentObject.addEventListener('click', event => {
      if (
        !elements.exportMenu.hidden &&
        !event.target.closest('.export-control')
      ) {
        setExportOpen(false);
      }
    });
    documentObject.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        setExportOpen(false);
        elements.exportButton.focus();
      }
    });
    for (const button of documentObject.querySelectorAll(
      '[data-artifact-key]'
    )) {
      button.disabled = true;
      button.addEventListener('click', downloadArtifact);
    }
    elements.productsSearch.addEventListener('input', () => {
      if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        itemState.q = elements.productsSearch.value;
        itemState.page = 1;
        loadItems();
      }, 300);
    });
    for (const button of elements.productFilters) {
      button.addEventListener('click', selectFilter);
    }
    for (const button of elements.sortButtons) {
      button.addEventListener('click', selectSort);
    }
    elements.productsPageSize.addEventListener('change', () => {
      itemState.pageSize = Number(elements.productsPageSize.value);
      itemState.page = 1;
      loadItems();
    });
    elements.productsPrevious.addEventListener('click', () => {
      if (itemState.page <= 1) return;
      itemState.page -= 1;
      loadItems();
    });
    elements.productsNext.addEventListener('click', () => {
      if (
        itemState.totalPages === 0 ||
        itemState.page >= itemState.totalPages
      ) return;
      itemState.page += 1;
      loadItems();
    });
    resetExports();
    resetItems();
    return {
      activateItems,
      loadItems,
      submitRun,
      updateFileSelection,
    };
  }

  const publicApi = {
    FrontendError,
    buildItemsUrl,
    createItemRow,
    createApplication,
    formatDuration,
    formatQuantity,
    formatRub,
    itemStatusView,
    paginationLabel,
    pollRunStatus,
    recommendedLineValue,
    recommendedQuantity,
    renderItemRows,
    requestJson,
    safeArtifactDownloadUrl,
    safeRunLink,
    selectArtifacts,
    setProductsPanelState,
    summaryView,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = publicApi;
  }
  if (globalObject) globalObject.PurchasingFrontend = publicApi;
  if (globalObject?.document && globalObject?.fetch) {
    globalObject.document.addEventListener('DOMContentLoaded', () => {
      createApplication(
        globalObject.document,
        globalObject.fetch.bind(globalObject)
      );
    });
  }
})(typeof window === 'undefined' ? null : window);
