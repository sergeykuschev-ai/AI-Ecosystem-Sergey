(function initializePurchasingFrontend(globalObject) {
  'use strict';

  const MAX_FILE_BYTES = 20 * 1024 * 1024;
  const POLL_INTERVAL_MS = 1000;
  const POLL_TIMEOUT_MS = 10 * 60 * 1000;
  const ALLOWED_FILE_PATTERN = /\.(xlsx|xls)$/i;
  const RUN_LINK_PATTERN =
    /^\/api\/v1\/runs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?:\/(?:summary|artifacts))?$/i;
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
      downloads: documentObject.getElementById('downloads'),
      downloadMessage: documentObject.getElementById('download-message'),
      calculationTime: documentObject.getElementById('calculation-time'),
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
      availableArtifacts = {};
      elements.results.hidden = true;
      elements.downloads.hidden = true;
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
      elements.downloadMessage.textContent =
        Object.keys(availableArtifacts).length === Object.keys(ARTIFACTS).length
          ? 'Файлы готовы к скачиванию.'
          : 'Часть файлов недоступна для скачивания.';
      elements.downloads.hidden = false;
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
      elements.downloads.hidden = true;
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
        if (!summaryUrl || !artifactsUrl) {
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
      const link = documentObject.createElement('a');
      link.href = artifact.downloadUrl;
      link.download = artifact.name;
      link.rel = 'noopener';
      documentObject.body.append(link);
      link.click();
      link.remove();
    }

    elements.fileInput.addEventListener('change', updateFileSelection);
    elements.form.addEventListener('submit', submitRun);
    for (const button of documentObject.querySelectorAll(
      '[data-artifact-key]'
    )) {
      button.disabled = true;
      button.addEventListener('click', downloadArtifact);
    }
    return {
      submitRun,
      updateFileSelection,
    };
  }

  const publicApi = {
    FrontendError,
    createApplication,
    formatDuration,
    formatRub,
    pollRunStatus,
    requestJson,
    safeArtifactDownloadUrl,
    safeRunLink,
    selectArtifacts,
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
