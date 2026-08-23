'use strict';

const ROUTES = Object.freeze({
  dashboard: ['Dashboard', 'Сводка показателей выбранного месяца.'],
  shifts: ['Смены', 'Создание, просмотр и безопасное редактирование смен.'],
  months: ['Месяцы', 'Помесячная динамика и статусы данных.'],
  year: ['Год', 'Годовая динамика KPI.'],
  sellers: ['Продавцы', 'Агрегаты сотрудников без средних от средних.'],
  bonuses: ['Премии', 'Расчёт премий по подтверждённой формуле Excel.'],
  settings: ['Настройки', 'План месяца и действующие нормативы KPI.'],
  'import-export': ['Импорт / экспорт', 'Исторический Excel-import остаётся вторичным каналом.'],
});
const PLACEHOLDER_ROUTES = new Set(['months', 'year', 'bonuses']);
const money = new Intl.NumberFormat('ru-RU', {
  style: 'currency', currency: 'RUB', maximumFractionDigits: 2,
});
const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 });
const percent = new Intl.NumberFormat('ru-RU', {
  style: 'percent', maximumFractionDigits: 1,
});

const state = {
  stores: [],
  employees: [],
  shifts: [],
  dashboard: null,
  importFile: null,
  importRun: null,
};

function element(id) { return document.getElementById(id); }
function displayMoney(value) { return value === null || value === undefined ? '—' : money.format(value); }
function displayNumber(value) { return value === null || value === undefined ? '—' : number.format(value); }
function displayPercent(value) { return value === null || value === undefined ? '—' : percent.format(value); }

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const response = await fetch(path, {
    headers: { ...(isFormData ? {} : { 'Content-Type': 'application/json' }), ...(options.headers || {}) },
    ...options,
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.error?.message || 'Не удалось выполнить запрос.');
    error.code = body.error?.code;
    error.details = body.error?.details;
    throw error;
  }
  return body.data;
}

function showMessage(message, kind = 'success') {
  const box = element('global-message');
  box.textContent = message;
  box.dataset.kind = kind;
  box.hidden = false;
  window.setTimeout(() => { box.hidden = true; }, 5000);
}

function selectedRoute() {
  const route = window.location.hash.slice(1);
  return Object.prototype.hasOwnProperty.call(ROUTES, route) ? route : 'dashboard';
}

function period() {
  const [year, month] = element('period-filter').value.split('-').map(Number);
  return { year, month };
}

function selectedStoreId() { return element('store-filter').value; }

function fillSelect(select, items, label, selected) {
  select.replaceChildren();
  for (const item of items) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item[label];
    option.selected = item.id === selected;
    select.append(option);
  }
}

async function loadReferenceData(preferredStore) {
  const query = preferredStore ? `?store=${encodeURIComponent(preferredStore)}` : '';
  const data = await api(`/api/business-kpi/reference-data${query}`);
  state.stores = data.stores;
  state.employees = data.employees;
  fillSelect(element('store-filter'), state.stores, 'name', data.selectedStoreId);
  fillSelect(element('shift-store'), state.stores, 'name', data.selectedStoreId);
  fillSelect(element('shift-employee'), state.employees, 'displayName');
  const employeeFilter = element('employee-filter');
  employeeFilter.replaceChildren(new Option('Все продавцы', ''));
  for (const employee of state.employees) {
    employeeFilter.append(new Option(employee.displayName, employee.id));
  }
}

function renderDashboard(data) {
  const month = data.month;
  element('metric-plan').textContent = displayMoney(month.plan);
  element('metric-status').textContent = month.status;
  element('metric-revenue').textContent = displayMoney(month.revenue);
  element('metric-forecast').textContent = `Прогноз ${displayMoney(month.forecast.projectedRevenue)}`;
  element('metric-completion').textContent = displayPercent(month.planCompletion);
  element('metric-remaining').textContent = `До плана ${displayMoney(month.forecast.remainingToPlan)}`;
  element('metric-receipts').textContent = displayNumber(month.receipts);
  element('metric-shifts').textContent = displayNumber(month.shiftsCount);
  element('metric-average-check').textContent = displayMoney(month.averageCheck);
  element('metric-items').textContent = displayNumber(month.itemsPerReceipt);
  element('metric-qr').textContent = displayPercent(month.qrShare);
  element('metric-days').textContent = `Дней с данными ${displayNumber(month.dataDays)}`;
  element('metric-daily-average').textContent = displayMoney(month.forecast.averageRevenuePerDataDay);
  element('metric-days-remaining').textContent = displayNumber(month.forecast.remainingCalendarDays);
  element('metric-required').textContent = `Нужно в день ${displayMoney(month.forecast.requiredAveragePerRemainingDay)}`;
  element('plan-input').value = month.plan ?? '';
}

async function loadDashboard() {
  const store = selectedStoreId();
  if (!store) return;
  const { year, month } = period();
  state.dashboard = await api(
    `/api/business-kpi/dashboard?store=${encodeURIComponent(store)}&year=${year}&month=${month}`
  );
  renderDashboard(state.dashboard);
  renderSellers(state.dashboard.sellers);
}

function appendCell(row, value, className) {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
}

function renderShifts(items) {
  const body = element('shifts-table');
  body.replaceChildren();
  element('shifts-empty').hidden = items.length !== 0;
  for (const shift of items) {
    const row = document.createElement('tr');
    appendCell(row, shift.shiftDate);
    appendCell(row, shift.employeeName || '—');
    appendCell(row, shift.source === 'excel_import' ? 'Excel import' : 'Ручной ввод');
    appendCell(row, displayMoney(shift.metrics?.revenue), 'numeric');
    appendCell(row, displayNumber(shift.receipts), 'numeric');
    appendCell(row, displayMoney(shift.metrics?.averageCheck), 'numeric');
    appendCell(row, displayNumber(shift.metrics?.itemsPerReceipt), 'numeric');
    appendCell(row, shift.metrics ? `${number.format(shift.metrics.kpiScore)} · ${shift.metrics.kpiLevel}` : '—');
    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-button';
    button.textContent = 'Открыть';
    button.addEventListener('click', () => openShiftById(shift.id));
    actionCell.append(button);
    row.append(actionCell);
    body.append(row);
  }
}

async function loadShifts() {
  const { year, month } = period();
  const employee = element('employee-filter').value;
  const query = new URLSearchParams({
    store: selectedStoreId(),
    year: String(year),
    month: String(month),
  });
  if (employee) query.set('employee', employee);
  const data = await api(`/api/business-kpi/shifts?${query}`);
  state.shifts = data.items;
  renderShifts(state.shifts);
}

function renderSellers(items) {
  const body = element('sellers-table');
  body.replaceChildren();
  element('sellers-empty').hidden = items.length !== 0;
  for (const seller of items) {
    const row = document.createElement('tr');
    appendCell(row, seller.employeeName || '—');
    appendCell(row, seller.shiftsCount, 'numeric');
    appendCell(row, displayMoney(seller.revenue), 'numeric');
    appendCell(row, displayMoney(seller.revenuePerShift), 'numeric');
    appendCell(row, seller.receipts, 'numeric');
    appendCell(row, displayMoney(seller.averageCheck), 'numeric');
    appendCell(row, displayNumber(seller.itemsPerReceipt), 'numeric');
    appendCell(row, displayPercent(seller.qrShare), 'numeric');
    appendCell(row, displayNumber(seller.averageKpi), 'numeric');
    appendCell(row, seller.kpiLevel);
    appendCell(row, displayMoney(seller.bonus), 'numeric');
    body.append(row);
  }
}

function renderSettings(record) {
  const list = element('settings-list');
  list.replaceChildren();
  const entries = [
    ['Версия', record.version],
    ['Действует с', record.effectiveFrom],
    ['Цель среднего чека', displayMoney(record.settings.targets.averageCheck)],
    ['Цель товаров в чеке', displayNumber(record.settings.targets.itemsPerReceipt)],
    ['Цель допродаж', displayPercent(record.settings.targets.upsellReceiptShare)],
    ['Цель лакомств за смену', displayMoney(record.settings.targets.treatsRevenue)],
    ['Цель чеков с лакомствами', displayPercent(record.settings.targets.treatsReceiptShare)],
    ['Цель QR share', record.settings.targets.qrShare === null ? 'Не задана в Excel (unresolved)' : displayPercent(record.settings.targets.qrShare)],
    ['Цель смены', displayMoney(record.settings.targets.shiftRevenue)],
    ['Норма смен продавца', displayNumber(record.settings.targets.sellerShifts)],
    ['Эквайринг', displayPercent(record.settings.fees.acquiring)],
    ['QR комиссия', displayPercent(record.settings.fees.qr)],
    ['Вес плана смены', displayNumber(record.settings.weights.shiftPlan)],
    ['Вес среднего чека', displayNumber(record.settings.weights.averageCheck)],
    ['Вес товаров в чеке', displayNumber(record.settings.weights.itemsPerReceipt)],
    ['Вес допродаж', displayNumber(record.settings.weights.upsell)],
    ['Вес лакомств', displayNumber(record.settings.weights.treats)],
    ['Уровни / bonus base', record.settings.levels.map(level => `${level.minimumScore}+ → ${level.name}: ${displayMoney(level.bonusBase)}`).join('; ')],
  ];
  for (const [name, value] of entries) {
    const term = document.createElement('dt');
    term.textContent = name;
    const detail = document.createElement('dd');
    detail.textContent = value;
    list.append(term, detail);
  }
}

async function loadSettings() {
  const { year, month } = period();
  const date = `${year}-${String(month).padStart(2, '0')}-01`;
  renderSettings(await api(
    `/api/business-kpi/settings?store=${encodeURIComponent(selectedStoreId())}&date=${date}`
  ));
}

async function renderRoute() {
  const routeId = selectedRoute();
  const [title, description] = ROUTES[routeId];
  element('page-title').textContent = title;
  element('page-description').textContent = description;
  document.querySelectorAll('[data-route]').forEach(link => {
    const active = link.dataset.route === routeId;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.querySelectorAll('.route-panel').forEach(panel => { panel.hidden = true; });
  const panelName = PLACEHOLDER_ROUTES.has(routeId) ? 'placeholder' : routeId;
  document.querySelector(`[data-panel="${panelName}"]`).hidden = false;
  element('open-shift-form').hidden = routeId !== 'dashboard' && routeId !== 'shifts';
  if (PLACEHOLDER_ROUTES.has(routeId)) {
    element('placeholder-title').textContent = title;
    element('placeholder-description').textContent = description;
  }
  try {
    if (routeId === 'dashboard') await loadDashboard();
    if (routeId === 'shifts') await loadShifts();
    if (routeId === 'sellers') {
      await loadDashboard();
      renderSellers(state.dashboard.sellers);
    }
    if (routeId === 'settings') {
      await Promise.all([loadDashboard(), loadSettings()]);
    }
    if (routeId === 'import-export') await loadImportRuns();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function numberInput(id) {
  const value = element(id).value;
  return value === '' ? null : Number(value);
}

function shiftPayload() {
  return {
    storeId: element('shift-store').value,
    employeeId: element('shift-employee').value,
    shiftDate: element('shift-date').value,
    shiftKey: element('shift-key').value,
    cash: numberInput('shift-cash'),
    acquiring: numberInput('shift-acquiring'),
    qr: numberInput('shift-qr'),
    receipts: numberInput('shift-receipts'),
    itemsSold: numberInput('shift-items'),
    upsellReceipts: numberInput('shift-upsells'),
    treatsRevenue: numberInput('shift-treats-revenue'),
    treatsReceipts: numberInput('shift-treats-receipts'),
    comment: element('shift-comment').value,
  };
}

function updatePreview() {
  if (element('shift-cash').readOnly) return;
  const cash = numberInput('shift-cash');
  const acquiring = numberInput('shift-acquiring');
  const qr = numberInput('shift-qr');
  const receipts = numberInput('shift-receipts');
  const items = numberInput('shift-items');
  const revenue = cash === null || acquiring === null ? null : cash + acquiring;
  const error = element('shift-error');
  if (qr !== null && acquiring !== null && qr > acquiring) {
    error.textContent = 'QR не может быть больше эквайринга.';
    error.hidden = false;
  } else if (error.dataset.server !== 'true') {
    error.hidden = true;
  }
  element('preview-revenue').textContent = displayMoney(revenue);
  element('preview-average').textContent = receipts > 0 && revenue !== null
    ? displayMoney(revenue / receipts)
    : '—';
  element('preview-items').textContent = receipts > 0 && items !== null ? displayNumber(items / receipts) : '—';
}

function setFormValue(id, value) { element(id).value = value ?? ''; }

function renderAudit(items = []) {
  const section = element('shift-audit-section');
  const list = element('shift-audit-list');
  list.replaceChildren();
  section.hidden = items.length === 0;
  for (const item of items) {
    const row = document.createElement('li');
    const occurred = new Date(item.occurredAt).toLocaleString('ru-RU');
    row.textContent = `${occurred} · ${item.action} · ${item.actorId}${item.reason ? ` · ${item.reason}` : ''}`;
    list.append(row);
  }
}

async function openShiftById(id) {
  try {
    const shift = await api(`/api/business-kpi/shifts/${id}`);
    openShiftDialog(shift);
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

function openShiftDialog(shift = null) {
  const dialog = element('shift-dialog');
  element('shift-form').reset();
  element('shift-error').hidden = true;
  element('shift-error').dataset.server = 'false';
  element('shift-id').value = shift?.id || '';
  element('shift-form-title').textContent = shift ? 'Редактирование смены' : 'Новая смена';
  element('shift-provenance').hidden = !shift;
  element('shift-provenance').textContent = shift
    ? `Источник: ${shift.source === 'excel_import' ? 'Excel import' : 'Ручной ввод'}${shift.override ? ' · есть ручной override' : ''}`
    : '';
  const historical = shift?.revenueSource === 'historical_total';
  for (const id of ['shift-cash', 'shift-acquiring', 'shift-qr']) {
    element(id).readOnly = historical;
    element(id).required = !historical;
  }
  for (const [id, field] of [
    ['shift-items', 'itemsSold'],
    ['shift-upsells', 'upsellReceipts'],
    ['shift-treats-revenue', 'treatsRevenue'],
    ['shift-treats-receipts', 'treatsReceipts'],
  ]) {
    element(id).required = !shift || shift[field] !== null;
  }
  element('archive-shift').hidden = !shift;
  setFormValue('shift-date', shift?.shiftDate || new Date().toISOString().slice(0, 10));
  setFormValue('shift-store', shift?.storeId || selectedStoreId());
  setFormValue('shift-employee', shift?.employeeId || state.employees[0]?.id);
  setFormValue('shift-key', shift?.shiftKey || 'main');
  setFormValue('shift-cash', historical ? null : shift?.cash ?? 0);
  setFormValue('shift-acquiring', historical ? null : shift?.acquiring ?? 0);
  setFormValue('shift-qr', historical ? null : shift?.qr ?? 0);
  setFormValue('shift-receipts', shift?.receipts ?? 0);
  setFormValue('shift-items', shift && shift.itemsSold === null ? null : shift?.itemsSold ?? 0);
  setFormValue('shift-upsells', shift && shift.upsellReceipts === null ? null : shift?.upsellReceipts ?? 0);
  setFormValue('shift-treats-revenue', shift && shift.treatsRevenue === null ? null : shift?.treatsRevenue ?? 0);
  setFormValue('shift-treats-receipts', shift && shift.treatsReceipts === null ? null : shift?.treatsReceipts ?? 0);
  setFormValue('shift-comment', shift?.comment || '');
  renderAudit(shift?.audit || []);
  updatePreview();
  if (historical) {
    element('preview-revenue').textContent = displayMoney(shift.metrics?.revenue);
    element('preview-average').textContent = displayMoney(shift.metrics?.averageCheck);
    element('preview-items').textContent = displayNumber(shift.metrics?.itemsPerReceipt);
  }
  dialog.showModal();
  element('shift-date').focus();
}

function renderImportRun(run) {
  state.importRun = run;
  const report = run.report;
  const panel = element('import-report');
  panel.hidden = !report;
  if (!report) return;
  element('import-detected').textContent = report.detected
    ? `${String(report.detected.month).padStart(2, '0')}.${report.detected.year} · ${report.detected.version}`
    : '—';
  element('import-store').textContent = report.store?.name || '—';
  element('import-rows').textContent = `${report.rows?.valid ?? 0} / ${report.rows?.read ?? 0}`;
  element('import-revenue').textContent = displayMoney(report.totals?.revenue);
  element('import-receipts').textContent = displayNumber(report.totals?.receipts);
  element('import-payments').textContent = report.paymentBreakdownAvailable ? 'Доступна' : 'Недоступна';
  const issues = [...(report.errors || []), ...(report.warnings || [])];
  const list = element('import-issues');
  list.replaceChildren();
  for (const item of issues) {
    const row = document.createElement('li');
    row.dataset.severity = item.severity;
    row.textContent = `${item.code}: ${item.message}${item.row ? ` (строка ${item.row})` : ''}`;
    list.append(row);
  }
  element('import-issues-empty').hidden = issues.length !== 0;
  element('commit-import').hidden = run.errorsCount !== 0 || run.status !== 'VALIDATING';
}

function renderImportRuns(items) {
  const body = element('import-runs-table');
  body.replaceChildren();
  for (const run of items) {
    const row = document.createElement('tr');
    appendCell(row, new Date(run.startedAt).toLocaleString('ru-RU'));
    appendCell(row, run.originalFilename || '—');
    appendCell(row, run.detectedYear ? `${String(run.detectedMonth).padStart(2, '0')}.${run.detectedYear}` : '—');
    appendCell(row, run.status);
    appendCell(row, `${run.rowsImported} / ${run.rowsRead}`, 'numeric');
    appendCell(row, run.reconciliationStatus);
    body.append(row);
  }
  element('import-runs-empty').hidden = items.length !== 0;
}

async function loadImportRuns() {
  const data = await api(`/api/business-kpi/imports?store=${encodeURIComponent(selectedStoreId())}`);
  renderImportRuns(data.items);
}

function selectImportFile(file) {
  state.importFile = file || null;
  state.importRun = null;
  element('selected-import-file').textContent = file ? file.name : 'Файл не выбран';
  element('dry-run-import').disabled = !file;
  element('import-report').hidden = true;
}

async function dryRunImport() {
  if (!state.importFile) return;
  const body = new FormData();
  body.append('storeId', selectedStoreId());
  body.append('file', state.importFile);
  element('dry-run-import').disabled = true;
  try {
    const run = await api('/api/business-kpi/imports/dry-run', { method: 'POST', body });
    renderImportRun(run);
    showMessage(run.duplicate ? 'Этот файл уже импортирован: повторная запись не создана.' : 'Dry-run завершён. Проверьте отчёт перед импортом.');
    await loadImportRuns();
  } catch (error) {
    showMessage(error.message, 'error');
  } finally {
    element('dry-run-import').disabled = !state.importFile;
  }
}

async function commitImport() {
  if (!state.importRun) return;
  element('commit-import').disabled = true;
  try {
    const run = await api(`/api/business-kpi/imports/${state.importRun.id}/commit`, { method: 'POST' });
    renderImportRun(run);
    showMessage('Исторические смены импортированы атомарно. Reconciliation: PASS.');
    const { year, month } = run.report.detected;
    element('period-filter').value = `${year}-${String(month).padStart(2, '0')}`;
    await Promise.all([loadImportRuns(), loadDashboard(), loadShifts()]);
  } catch (error) {
    showMessage(error.message, 'error');
    await loadImportRuns();
  } finally {
    element('commit-import').disabled = false;
  }
}

function exportSelectedMonth() {
  const { year, month } = period();
  const query = new URLSearchParams({ store: selectedStoreId(), year, month });
  window.location.assign(`/api/business-kpi/export?${query}`);
}

async function saveShift(event) {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  const id = element('shift-id').value;
  const errorBox = element('shift-error');
  element('save-shift').disabled = true;
  try {
    await api(id ? `/api/business-kpi/shifts/${id}` : '/api/business-kpi/shifts', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(shiftPayload()),
    });
    element('shift-dialog').close();
    showMessage(id ? 'Смена обновлена. KPI пересчитаны.' : 'Смена создана. Dashboard обновлён.');
    await Promise.all([loadDashboard(), loadShifts()]);
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.dataset.server = 'true';
    errorBox.hidden = false;
  } finally {
    element('save-shift').disabled = false;
  }
}

async function archiveShift() {
  const id = element('shift-id').value;
  if (!id || !window.confirm('Архивировать смену? История изменений сохранится.')) return;
  try {
    await api(`/api/business-kpi/shifts/${id}`, { method: 'DELETE' });
    element('shift-dialog').close();
    showMessage('Смена архивирована.');
    await Promise.all([loadDashboard(), loadShifts()]);
  } catch (error) {
    const errorBox = element('shift-error');
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
}

async function savePlan(event) {
  event.preventDefault();
  const { year, month } = period();
  try {
    await api(`/api/business-kpi/plans/${year}/${month}`, {
      method: 'PUT',
      body: JSON.stringify({
        storeId: selectedStoreId(),
        revenuePlan: Number(element('plan-input').value),
        reason: element('plan-reason').value,
      }),
    });
    element('plan-reason').value = '';
    showMessage('План месяца сохранён и записан в аудит.');
    await loadDashboard();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

async function initialize() {
  const now = new Date();
  element('period-filter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  try {
    const health = await api('/health');
    element('runtime-mode').textContent = health.mode === 'LOCAL_DEV'
      ? `LOCAL_DEV · ${health.storage.configured ? 'PostgreSQL' : 'память процесса'}`
      : health.mode;
    await loadReferenceData();
    await renderRoute();
  } catch (error) {
    showMessage(error.message, 'error');
  }
}

window.addEventListener('hashchange', renderRoute);
element('store-filter').addEventListener('change', async () => {
  await loadReferenceData(selectedStoreId());
  await renderRoute();
});
element('period-filter').addEventListener('change', renderRoute);
element('employee-filter').addEventListener('change', loadShifts);
element('open-shift-form').addEventListener('click', () => openShiftDialog());
element('close-shift-form').addEventListener('click', () => element('shift-dialog').close());
element('cancel-shift').addEventListener('click', () => element('shift-dialog').close());
element('archive-shift').addEventListener('click', archiveShift);
element('shift-form').addEventListener('submit', saveShift);
element('shift-form').addEventListener('input', event => {
  element('shift-error').dataset.server = 'false';
  updatePreview(event);
});
element('plan-form').addEventListener('submit', savePlan);
element('import-file').addEventListener('change', event => selectImportFile(event.target.files[0]));
element('import-dropzone').addEventListener('dragover', event => {
  event.preventDefault();
  event.currentTarget.classList.add('dragging');
});
element('import-dropzone').addEventListener('dragleave', event => event.currentTarget.classList.remove('dragging'));
element('import-dropzone').addEventListener('drop', event => {
  event.preventDefault();
  event.currentTarget.classList.remove('dragging');
  selectImportFile(event.dataTransfer.files[0]);
});
element('dry-run-import').addEventListener('click', dryRunImport);
element('commit-import').addEventListener('click', commitImport);
element('export-month').addEventListener('click', exportSelectedMonth);
initialize();
