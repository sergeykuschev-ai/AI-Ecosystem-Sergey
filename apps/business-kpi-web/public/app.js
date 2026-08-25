'use strict';

const ROUTES = Object.freeze({
  dashboard: ['Главная', 'Управленческая сводка выбранного месяца.'],
  shifts: ['Смены', 'Создание, просмотр и безопасное редактирование смен.'],
  months: ['Месяцы', 'Помесячная динамика и статусы данных.'],
  year: ['Год', 'Годовая динамика KPI.'],
  sellers: ['Продавцы', 'Агрегаты сотрудников без средних от средних.'],
  bonuses: ['Премии', 'Расчёт премий.'],
  settings: ['Настройки', 'План месяца и действующие нормативы KPI.'],
  'import-export': ['Импорт / экспорт', 'Исторический Excel-import остаётся вторичным каналом.'],
});

/* Business context.
   The portal is currently branded for MISKA only, but the architecture is
   multi-business ready: a future business switch can replace this object
   and the CSS theme tokens without touching module components. */
const BUSINESS_CONTEXT = Object.freeze({
  id: 'miska',
  name: 'МИСКА',
  shortName: 'МИСКА',
  portalName: 'Business Portal',
  moduleName: 'KPI',
});

const THEME_COLORS = Object.freeze({
  primary: 'var(--brand-primary)',
  primarySoft: 'var(--brand-primary-soft)',
  accent: 'var(--brand-secondary-accent)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',
  textSecondary: 'var(--text-secondary)',
});

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const state = {
  stores: [],
  employees: [],
  shifts: [],
  dashboard: null,
  importFile: null,
  importRun: null,
  months: [],
  yearSummary: null,
  bonuses: null,
  today: null,
  settings: null,
  selectedSeller: null,
  currentUser: null,
};

function element(id) { return document.getElementById(id); }

function parseCookies(header) {
  const cookies = Object.create(null);
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name) cookies[name] = decodeURIComponent(rest.join('='));
  }
  return cookies;
}

function csrfToken() {
  return parseCookies(document.cookie)['business_kpi_csrf'] || '';
}

function roleLabel(role) {
  return { OWNER: 'Владелец', MANAGER: 'Менеджер', SELLER: 'Продавец' }[role] || role;
}

function redirectToLogin() {
  window.location.replace('/login.html');
}

function canViewRoute(route) {
  const role = state.currentUser?.role;
  if (role === 'OWNER') return true;
  if (role === 'MANAGER') {
    return !['settings'].includes(route);
  }
  if (role === 'SELLER') {
    return ['dashboard', 'shifts', 'months', 'year', 'sellers', 'bonuses'].includes(route);
  }
  return false;
}

function canCreateShift() {
  const role = state.currentUser?.role;
  return role === 'OWNER' || role === 'MANAGER' || role === 'SELLER';
}

function canEditShift(shift) {
  const role = state.currentUser?.role;
  if (role === 'OWNER' || role === 'MANAGER') return true;
  if (role !== 'SELLER') return false;
  if (!shift) return true;
  if (shift.source !== 'web_manual') return false;
  return shift.employeeId === state.currentUser?.employeeId;
}

function canArchiveShift(shift) {
  const role = state.currentUser?.role;
  if (role === 'OWNER' || role === 'MANAGER') return true;
  if (role !== 'SELLER') return false;
  if (!shift || shift.source !== 'web_manual') return false;
  return shift.employeeId === state.currentUser?.employeeId;
}

async function api(path, options = {}) {
  const isFormData = options.body instanceof FormData;
  const isStateChanging = options.method && options.method !== 'GET' && options.method !== 'HEAD';
  const headers = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...(isStateChanging && !isFormData ? { 'x-csrf-token': csrfToken() } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(path, {
    headers,
    ...options,
  });
  if (response.status === 401 && !path.includes('/auth/')) {
    window.location.replace('/login.html');
    return null;
  }
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

function selectedYear() {
  return Number(element('year-filter').value) || new Date().getFullYear();
}

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

function setPill(id, status) {
  const pill = element(id);
  const info = uiDataStatus(status);
  pill.textContent = info.label;
  pill.className = classNames('status-pill', info.tone);
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

async function loadEffectiveSettings() {
  const store = selectedStoreId();
  if (!store) return;
  const { year, month } = period();
  const date = `${year}-${String(month).padStart(2, '0')}-01`;
  try {
    const record = await api(`/api/business-kpi/settings?store=${encodeURIComponent(store)}&date=${date}`);
    state.settings = record.settings;
  } catch (error) {
    state.settings = null;
  }
}

function renderDashboard(data) {
  const month = data.month;
  element('metric-plan').textContent = formatMoney(month.plan);
  const statusInfo = uiMonthStatus(month.status);
  const statusEl = element('metric-status');
  statusEl.textContent = statusInfo.label;
  statusEl.className = statusInfo.tone;
  element('metric-revenue').textContent = formatMoney(month.revenue);
  element('metric-revenue-note').textContent = 'Фактическая выручка';
  element('metric-completion').textContent = formatPercent(month.planCompletion);

  const completionBar = element('metric-completion-bar').querySelector('span');
  const completionPct = Math.min(100, Math.max(0, (month.planCompletion || 0) * 100));
  completionBar.style.width = `${completionPct}%`;
  const completionStatusEl = element('metric-completion-status');
  const forecast = month.forecast.projectedRevenue;
  const plan = month.plan;
  if (month.revenue !== null && plan !== null && month.revenue >= plan) {
    completionStatusEl.textContent = 'План выполнен';
  } else if (forecast !== null && plan !== null && forecast > plan) {
    completionStatusEl.textContent = 'Прогноз выполнения выше плана';
  } else {
    completionStatusEl.textContent = 'Есть риск невыполнения';
  }

  element('metric-projected-revenue').textContent = formatMoney(forecast);
  const projectedVsPlanEl = element('metric-projected-vs-plan');
  if (forecast !== null && plan !== null) {
    const diff = forecast - plan;
    projectedVsPlanEl.textContent = diff >= 0
      ? `Прогноз выше плана на ${formatMoney(diff)}`
      : `Прогноз ниже плана на ${formatMoney(Math.abs(diff))}`;
  } else {
    projectedVsPlanEl.textContent = 'Прогноз выполнения —';
  }

  element('metric-remaining-to-plan').textContent = formatMoney(month.forecast.remainingToPlan);
  element('metric-days-remaining').textContent = `Осталось дней ${formatInteger(month.forecast.remainingCalendarDays)}`;
  element('metric-required-per-day').textContent = formatMoney(month.forecast.requiredAveragePerRemainingDay);
  element('metric-daily-average').textContent = formatMoney(month.forecast.averageRevenuePerDataDay);

  const required = month.forecast.requiredAveragePerRemainingDay;
  const current = month.forecast.averageRevenuePerDataDay;
  const paceDeltaEl = element('metric-pace-delta');
  const paceNoteEl = element('metric-pace-note');
  if (required !== null && required > 0 && current !== null) {
    const delta = (current / required - 1) * 100;
    paceDeltaEl.textContent = `${Math.abs(delta).toFixed(1)}%`;
    paceNoteEl.textContent = delta >= 0
      ? `Темп выше необходимого на ${Math.abs(delta).toFixed(1)}%`
      : `Темп ниже необходимого на ${Math.abs(delta).toFixed(1)}%`;
  } else {
    paceDeltaEl.textContent = UNAVAILABLE;
    paceNoteEl.textContent = 'Недостаточно данных для сравнения темпов';
  }

  element('metric-receipts').textContent = formatInteger(month.receipts);
  element('metric-shifts').textContent = formatInteger(month.shiftsCount);
  element('metric-average-check').textContent = formatMoney(month.averageCheck);
  element('metric-items').textContent = formatNumber(month.itemsPerReceipt);
  element('metric-qr').textContent = formatPercent(month.qrShare);
  element('metric-qr-amount').textContent = formatMoney(month.qr);
  element('metric-days').textContent = `Дней с данными ${formatInteger(month.dataDays)}`;
  element('plan-input').value = moneyInput(month.plan);

  renderAttention(month, data.sellers || []);
  element('partial-data-note').hidden = month.dataStatus !== 'PARTIAL';
  renderToday(data.today);
  renderDashboardSellers(data.sellers);
  renderDashboardPlanChart(month.days || data.days, month.plan);
  renderDashboardRevenueChart(month.days || data.days);
}

function renderAttention(month, sellers) {
  const list = element('attention-list');
  list.replaceChildren();
  const items = [];
  const targets = state.settings?.targets;

  if (month.dataStatus === 'PARTIAL') {
    items.push('Нет данных за часть смен — проверьте журнал смен.');
  }
  if (targets?.averageCheck && month.averageCheck !== null && month.averageCheck < targets.averageCheck) {
    items.push(`Средний чек ${formatMoney(month.averageCheck)} ниже цели ${formatMoney(targets.averageCheck)}.`);
  }
  if (targets?.itemsPerReceipt && month.itemsPerReceipt !== null && month.itemsPerReceipt < targets.itemsPerReceipt) {
    items.push(`Товаров в чеке ${formatNumber(month.itemsPerReceipt)} ниже цели ${formatNumber(targets.itemsPerReceipt)}.`);
  }
  if (targets?.qrShare !== null && targets?.qrShare !== undefined && month.qrShare !== null && month.qrShare < targets.qrShare) {
    items.push(`Доля QR ${formatPercent(month.qrShare)} ниже цели ${formatPercent(targets.qrShare)}.`);
  }
  if (month.forecast.requiredAveragePerRemainingDay !== null && month.forecast.requiredAveragePerRemainingDay > 0 &&
      month.forecast.averageRevenuePerDataDay !== null &&
      month.forecast.averageRevenuePerDataDay < month.forecast.requiredAveragePerRemainingDay) {
    items.push('Текущий дневной темп ниже требуемого для выполнения плана.');
  }
  const lowKpiSeller = sellers.find(seller => seller.averageKpi !== null && seller.averageKpi < 75);
  if (lowKpiSeller) {
    items.push(`Продавец ${lowKpiSeller.employeeName || '—'} имеет средний KPI ниже 75.`);
  }

  if (items.length === 0) {
    const li = document.createElement('li');
    li.textContent = 'Критичных отклонений нет';
    list.append(li);
  } else {
    const limit = Math.min(5, Math.max(3, items.length));
    for (const text of items.slice(0, limit)) {
      const li = document.createElement('li');
      li.textContent = text;
      list.append(li);
    }
  }
}

function renderDashboardPlanChart(days, planValue) {
  const container = element('dashboard-chart-plan');
  if (!container || days.length === 0) {
    if (container) container.innerHTML = '<p class="empty-copy">Нет данных для графика.</p>';
    return;
  }
  const labels = days.map(d => d.date.slice(8, 10));
  let cumulative = 0;
  const cumulativeValues = days.map(d => { cumulative += d.revenue || 0; return cumulative; });
  const planValues = planValue !== null && planValue !== undefined
    ? days.map((_, i) => (planValue / days.length) * (i + 1))
    : [];
  renderLineChart('dashboard-chart-plan', labels, [cumulativeValues, planValues], ['Накопительный факт', 'Накопительный план'], [THEME_COLORS.primary, THEME_COLORS.borderStrong], formatMoneyAxis, formatMoney);
}

function renderDashboardRevenueChart(days) {
  const container = element('dashboard-chart-revenue');
  if (!container || days.length === 0) {
    if (container) container.innerHTML = '<p class="empty-copy">Нет данных для графика.</p>';
    return;
  }
  const labels = days.map(d => d.date.slice(8, 10));
  const values = days.map(d => d.revenue || 0);
  renderBarChart('dashboard-chart-revenue', labels, [{ label: 'Выручка', values, color: THEME_COLORS.primary }], formatMoneyAxis);
}

function renderToday(data) {
  if (!data) {
    element('today-grid').hidden = true;
    element('today-shifts-wrap').hidden = true;
    element('today-empty').hidden = false;
    setPill('today-status', 'NO_DATA');
    return;
  }
  element('today-grid').hidden = false;
  element('today-shifts-wrap').hidden = data.shifts.length === 0;
  element('today-empty').hidden = data.shifts.length !== 0;
  setPill('today-status', data.aggregate.dataStatus);
  element('today-revenue').textContent = formatMoney(data.aggregate.revenue);
  element('today-receipts').textContent = formatInteger(data.aggregate.receipts);
  element('today-average-check').textContent = formatMoney(data.aggregate.averageCheck);
  element('today-items').textContent = formatNumber(data.aggregate.itemsPerReceipt);
  element('today-qr').textContent = formatPercent(data.aggregate.qrShare);
  element('today-shifts').textContent = formatInteger(data.aggregate.shiftsCount);
  const body = element('today-shifts-table');
  body.replaceChildren();
  for (const shift of data.shifts) {
    const row = document.createElement('tr');
    appendCell(row, shift.employeeName || NA_TEXT);
    appendCell(row, shiftKeyLabel(shift.shiftKey));
    appendCell(row, formatMoney(shift.metrics?.revenue), 'numeric');
    appendCell(row, formatInteger(shift.receipts), 'numeric');
    appendCell(row, formatMoney(shift.metrics?.averageCheck), 'numeric');
    appendCell(row, kpiLabel(shift.metrics?.kpiScore, shift.metrics?.kpiLevel));
    body.append(row);
  }
}

function renderDashboardSellers(items) {
  const body = element('dashboard-sellers-table');
  body.replaceChildren();
  element('dashboard-sellers-empty').hidden = items.length !== 0;
  for (const seller of items) {
    const row = document.createElement('tr');
    appendCell(row, seller.employeeName || NA_TEXT);
    appendCell(row, formatInteger(seller.shiftsCount), 'numeric');
    appendCell(row, formatMoney(seller.revenuePerShift), 'numeric');
    appendCell(row, formatMoney(seller.averageCheck), 'numeric');
    appendCell(row, formatNumber(seller.itemsPerReceipt), 'numeric');
    appendCell(row, formatPercent(seller.qrShare), 'numeric');
    appendCell(row, kpiLabel(seller.averageKpi, seller.kpiLevel));
    appendCell(row, seller.bonusStatus === 'COMPLETE' ? formatMoney(seller.bonus)
      : (seller.bonusStatus === 'ACCESS_DENIED' ? 'Недоступно' : NA_TEXT), 'numeric');
    if (seller.missingFields && seller.missingFields.length > 0) {
      row.title = `Недостающие поля: ${seller.missingFields.map(russianMissingField).join(', ')}`;
    }
    body.append(row);
  }
}

function russianMissingField(key) {
  const map = {
    itemsSold: 'продано единиц',
    upsellReceipts: 'чеки с допродажей',
    treatsRevenue: 'выручка лакомств',
    treatsReceipts: 'чеки с лакомствами',
  };
  return map[key] || key;
}

async function loadDashboard() {
  const store = selectedStoreId();
  if (!store) return;
  const { year, month } = period();
  state.dashboard = await api(
    `/api/business-kpi/dashboard?store=${encodeURIComponent(store)}&year=${year}&month=${month}`
  );
  state.today = await api(`/api/business-kpi/today?store=${encodeURIComponent(store)}`);
  renderDashboard({ ...state.dashboard, today: state.today });
}

function appendCell(row, value, className) {
  const cell = document.createElement('td');
  cell.textContent = value;
  if (className) cell.className = className;
  row.append(cell);
}

function appendKpiCell(row, score, level, className) {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.innerHTML = kpiWithBadge(score, level);
  row.append(cell);
}

function renderShifts(items) {
  const body = element('shifts-table');
  body.replaceChildren();
  element('shifts-empty').hidden = items.length !== 0;
  const sourceFilter = element('source-filter').value;
  const statusFilter = element('data-status-filter').value;
  const sort = element('shifts-sort').value;

  const quality = { total: items.length, complete: 0, partial: 0, noData: 0 };
  for (const shift of items) {
    const status = resolveShiftDataStatus(shift);
    if (status === 'COMPLETE') quality.complete += 1;
    else if (status === 'PARTIAL') quality.partial += 1;
    else quality.noData += 1;
  }
  element('shifts-quality-summary').textContent =
    `${quality.total} смен, ${quality.complete} полных, ${quality.partial} частичных`;

  let filtered = items.filter(shift => {
    if (sourceFilter && shift.source !== sourceFilter) return false;
    if (statusFilter) {
      if (resolveShiftDataStatus(shift) !== statusFilter) return false;
    }
    return true;
  });
  filtered.sort((left, right) => {
    switch (sort) {
      case 'date-asc': return left.shiftDate.localeCompare(right.shiftDate);
      case 'date-desc': return right.shiftDate.localeCompare(left.shiftDate);
      case 'revenue-asc': return (left.metrics?.revenue || 0) - (right.metrics?.revenue || 0);
      case 'revenue-desc': return (right.metrics?.revenue || 0) - (left.metrics?.revenue || 0);
      case 'avg-asc': return (left.metrics?.averageCheck || 0) - (right.metrics?.averageCheck || 0);
      case 'avg-desc': return (right.metrics?.averageCheck || 0) - (left.metrics?.averageCheck || 0);
      case 'kpi-asc': return (left.metrics?.kpiScore || 0) - (right.metrics?.kpiScore || 0);
      case 'kpi-desc': return (right.metrics?.kpiScore || 0) - (left.metrics?.kpiScore || 0);
      default: return 0;
    }
  });
  for (const shift of filtered) {
    const row = document.createElement('tr');
    row.className = 'clickable-row';
    const status = resolveShiftDataStatus(shift);
    appendCell(row, formatDate(shift.shiftDate));
    appendCell(row, shift.employeeName || NA_TEXT);
    appendCell(row, sourceLabel(shift.source));
    appendCell(row, formatMoney(shift.metrics?.revenue), 'numeric');
    appendCell(row, formatInteger(shift.receipts), 'numeric');
    appendCell(row, formatMoney(shift.metrics?.averageCheck), 'numeric');
    appendCell(row, formatNumber(shift.metrics?.itemsPerReceipt), 'numeric');
    appendCell(row, formatPercent(shift.metrics?.qrShare), 'numeric');
    appendKpiCell(row, shift.metrics?.kpiScore, shift.metrics?.kpiLevel, 'numeric');
    const statusInfo = uiDataStatus(status);
    const statusCell = document.createElement('td');
    statusCell.innerHTML = `<span class="status-pill ${statusInfo.tone}">${statusInfo.label}</span>`;
    row.append(statusCell);
    if (status === 'PARTIAL') {
      const missing = shiftMissingFields(shift);
      if (missing.length > 0) {
        row.title = `Недостающие поля: ${missing.map(russianMissingField).join(', ')}`;
      }
    }
    const actionCell = document.createElement('td');
    actionCell.className = 'action-column';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'table-button';
    button.textContent = 'Открыть';
    button.addEventListener('click', event => {
      event.stopPropagation();
      openShiftById(shift.id);
    });
    actionCell.append(button);
    row.append(actionCell);
    row.addEventListener('click', () => openShiftById(shift.id));
    body.append(row);
  }
}

function resolveShiftDataStatus(shift) {
  return shift.metrics?.kpiStatus === 'COMPLETE' && shift.metrics?.paymentBreakdownAvailable !== false
    ? 'COMPLETE'
    : (shift.receipts === 0 && shift.metrics?.revenue === 0 ? 'NO_DATA' : 'PARTIAL');
}

function shiftMissingFields(shift) {
  const missing = [];
  if (shift.itemsSold === null || shift.itemsSold === undefined) missing.push('itemsSold');
  if (shift.upsellReceipts === null || shift.upsellReceipts === undefined) missing.push('upsellReceipts');
  if (shift.treatsRevenue === null || shift.treatsRevenue === undefined) missing.push('treatsRevenue');
  if (shift.treatsReceipts === null || shift.treatsReceipts === undefined) missing.push('treatsReceipts');
  return missing;
}

function kpiWithBadge(score, level) {
  if (isUnavailable(score)) return UNAVAILABLE;
  return `${formatNumber(score)} ${level && level !== 'null' ? `<span class="kpi-badge">${level}</span>` : ''}`;
}

function formatPercentAxis(value) {
  if (isUnavailable(value)) return UNAVAILABLE;
  return `${Math.round(value * 100)}%`;
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
  const targets = state.settings?.targets || {};
  for (const seller of items) {
    const row = document.createElement('tr');
    row.className = 'clickable-row';
    appendCell(row, seller.employeeName || NA_TEXT);
    appendCell(row, formatInteger(seller.shiftsCount), 'numeric');
    appendCell(row, formatMoney(seller.revenuePerShift), 'numeric');
    appendCell(row, formatMoney(targets.shiftRevenue), 'numeric');
    appendCell(row, formatMoney(seller.averageCheck), 'numeric');
    appendCell(row, formatMoney(targets.averageCheck), 'numeric');
    appendCell(row, formatNumber(seller.itemsPerReceipt), 'numeric');
    appendCell(row, formatNumber(targets.itemsPerReceipt), 'numeric');
    appendCell(row, formatPercent(seller.qrShare), 'numeric');
    appendCell(row, kpiLabel(seller.averageKpi, seller.kpiLevel));
    appendCell(row, seller.kpiLevel || NA_TEXT);
    appendCell(row, seller.bonusStatus === 'COMPLETE' ? formatMoney(seller.bonus)
      : (seller.bonusStatus === 'ACCESS_DENIED' ? 'Недоступно' : NA_TEXT), 'numeric');
    if (seller.missingFields && seller.missingFields.length > 0) {
      row.title = `Недостающие поля: ${seller.missingFields.map(russianMissingField).join(', ')}`;
    }
    row.addEventListener('click', () => openSellerDetail(seller));
    body.append(row);
  }
}

async function openSellerDetail(seller) {
  state.selectedSeller = seller;
  const detail = element('seller-detail-card');
  detail.hidden = false;
  element('seller-detail-name').textContent = seller.employeeName || NA_TEXT;
  detail.scrollIntoView({ behavior: 'smooth' });
  const metrics = element('seller-metrics');
  metrics.replaceChildren();
  const targets = state.settings?.targets || {};
  const metricItems = [
    ['Смены', formatInteger(seller.shiftsCount)],
    ['Выручка', formatMoney(seller.revenue)],
    ['На смену', formatMoney(seller.revenuePerShift)],
    ['Цель на смену', formatMoney(targets.shiftRevenue)],
    ['Средний чек', formatMoney(seller.averageCheck)],
    ['Цель среднего чека', formatMoney(targets.averageCheck)],
    ['Товаров в чеке', formatNumber(seller.itemsPerReceipt)],
    ['Цель товаров в чеке', formatNumber(targets.itemsPerReceipt)],
    ['Доля QR', formatPercent(seller.qrShare)],
    ['KPI', kpiLabel(seller.averageKpi, seller.kpiLevel)],
    ['Уровень', seller.kpiLevel || NA_TEXT],
    ['Премия', seller.bonusStatus === 'COMPLETE' ? formatMoney(seller.bonus)
      : (seller.bonusStatus === 'ACCESS_DENIED' ? 'Недоступно' : NA_TEXT)],
  ];
  for (const [label, value] of metricItems) {
    const div = document.createElement('div');
    div.className = 'metric';
    div.innerHTML = `<small>${label}</small><strong>${value}</strong>`;
    metrics.append(div);
  }
  if (seller.missingFields && seller.missingFields.length > 0) {
    const note = document.createElement('p');
    note.className = 'field-help';
    note.textContent = `Недостающие поля: ${seller.missingFields.map(russianMissingField).join(', ')}`;
    metrics.append(note);
  }
  const store = selectedStoreId();
  const { year, month } = period();
  const shifts = await api(
    `/api/business-kpi/shifts?store=${encodeURIComponent(store)}&year=${year}&month=${month}&employee=${encodeURIComponent(seller.employeeId)}`
  );
  const rows = shifts.items.sort((a, b) => a.shiftDate.localeCompare(b.shiftDate));
  const body = element('seller-shifts-table');
  body.replaceChildren();
  for (const shift of rows) {
    const row = document.createElement('tr');
    appendCell(row, formatDate(shift.shiftDate));
    appendCell(row, formatMoney(shift.metrics?.revenue), 'numeric');
    appendCell(row, formatInteger(shift.receipts), 'numeric');
    appendCell(row, formatMoney(shift.metrics?.averageCheck), 'numeric');
    appendCell(row, formatNumber(shift.metrics?.itemsPerReceipt), 'numeric');
    appendCell(row, formatPercent(shift.metrics?.qrShare), 'numeric');
    appendCell(row, kpiLabel(shift.metrics?.kpiScore, shift.metrics?.kpiLevel));
    body.append(row);
  }
  renderSellerCharts(rows);
}

function renderSellerCharts(rows) {
  const dates = rows.map(r => formatDate(r.shiftDate));
  renderLineChart('seller-chart-kpi', dates, [rows.map(r => r.metrics?.kpiScore)], ['KPI'], [THEME_COLORS.primary]);
  renderLineChart('seller-chart-average', dates, [rows.map(r => r.metrics?.averageCheck)], ['Средний чек'], [THEME_COLORS.accent], formatMoneyAxis, formatMoney);
  renderLineChart('seller-chart-items', dates, [rows.map(r => r.metrics?.itemsPerReceipt)], ['Товаров в чеке'], [THEME_COLORS.primary]);
  renderLineChart('seller-chart-qr', dates, [rows.map(r => r.metrics?.qrShare)], ['Доля QR'], [THEME_COLORS.primary], formatPercentAxis, formatPercent);
  renderBarChart('seller-chart-revenue', dates, [{ label: 'Выручка', values: rows.map(r => r.metrics?.revenue), color: THEME_COLORS.primary }], formatMoneyAxis);
  renderLineChart('seller-chart-revenue-per-shift', dates, [rows.map(r => r.metrics?.revenue)], ['Выручка за смену'], [THEME_COLORS.accent], formatMoneyAxis, formatMoney);
}

function renderMonths(data) {
  state.months = data.items;
  element('months-year-label').textContent = String(data.year);
  const body = element('months-table');
  body.replaceChildren();
  element('months-empty').hidden = data.items.some(m => m.dataStatus !== 'NO_DATA');
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const labels = [];
  const revenue = [];
  const plan = [];
  const average = [];
  for (const month of data.items) {
    const isCurrent = data.year === currentYear && month.month === currentMonth;
    const label = isCurrent ? `${MONTH_NAMES[month.month - 1]} · Текущий месяц` : MONTH_NAMES[month.month - 1];
    if (month.dataStatus !== 'NO_DATA') {
      labels.push(label);
      revenue.push(month.revenue);
      plan.push(month.plan);
      average.push(month.averageCheck);
    }
    const row = document.createElement('tr');
    if (isCurrent) row.classList.add('current-row');
    appendCell(row, label);
    appendCell(row, formatMoney(month.plan), 'numeric');
    appendCell(row, formatMoney(month.revenue), 'numeric');
    appendCell(row, isCurrent && month.forecast?.projectedRevenue !== null && month.forecast?.projectedRevenue !== undefined
      ? formatMoney(month.forecast.projectedRevenue)
      : '—', 'numeric');
    appendCell(row, formatPercent(month.planCompletion), 'numeric');
    appendCell(row, formatInteger(month.receipts), 'numeric');
    appendCell(row, formatMoney(month.averageCheck), 'numeric');
    appendCell(row, formatNumber(month.itemsPerReceipt), 'numeric');
    appendCell(row, month.qrShare === null ? NA_TEXT : formatPercent(month.qrShare), 'numeric');
    appendCell(row, formatInteger(month.shiftsCount), 'numeric');
    const statusInfo = uiDataStatus(month.dataStatus);
    const statusCell = document.createElement('td');
    statusCell.innerHTML = `<span class="status-pill ${statusInfo.tone}">${statusInfo.label}</span>`;
    row.append(statusCell);
    const change = month.changeFromPreviousMonth;
    const changeText = change === null
      ? '—'
      : `${change >= 0 ? '+' : ''}${formatMoney(change)}${isCurrent ? ' (месяц не завершён)' : ''}`;
    appendCell(row, changeText, 'numeric');
    body.append(row);
  }
  renderBarChart('months-chart-revenue', labels, [
    { label: 'План', values: plan, color: THEME_COLORS.borderStrong },
    { label: 'Факт', values: revenue, color: THEME_COLORS.primary },
  ], formatMoneyAxis);
  renderLineChart('months-chart-average', labels, [average], ['Средний чек'], [THEME_COLORS.accent], formatMoneyAxis, formatMoney);
}

async function loadMonths() {
  const store = selectedStoreId();
  if (!store) return;
  const year = selectedYear();
  renderMonths(await api(
    `/api/business-kpi/months?store=${encodeURIComponent(store)}&year=${year}`
  ));
}

function renderYear(data) {
  state.yearSummary = data;
  element('year-revenue').textContent = formatMoney(data.ytd.revenue);
  element('year-plan').textContent = formatMoney(data.ytd.plan);
  element('year-completion').textContent = formatPercent(data.ytd.planCompletion);
  element('year-receipts').textContent = formatInteger(data.ytd.receipts);
  element('year-average-check').textContent = formatMoney(data.ytd.averageCheck);
  element('year-shifts').textContent = formatInteger(data.ytd.shiftsCount);

  element('year-completed-revenue').textContent = formatMoney(data.ytdCompleted.revenue);
  element('year-completed-plan').textContent = formatMoney(data.ytdCompleted.plan);
  element('year-completed-completion').textContent = formatPercent(data.ytdCompleted.planCompletion);
  element('year-completed-average-check').textContent = formatMoney(data.ytdCompleted.averageCheck);

  const current = data.currentMonthSummary;
  element('year-current-month-card').hidden = !current;
  if (current) {
    element('year-current-month-name').textContent = MONTH_NAMES[current.month - 1];
    element('year-current-revenue').textContent = formatMoney(current.revenue);
    element('year-current-plan').textContent = formatMoney(current.plan);
    element('year-current-completion').textContent = formatPercent(current.planCompletion);
    element('year-current-forecast').textContent = current.forecast?.projectedRevenue !== null
      ? formatMoney(current.forecast.projectedRevenue)
      : NA_TEXT;
  }

  element('year-best-revenue').textContent = data.bests.revenue
    ? `${MONTH_NAMES[data.bests.revenue.month - 1]} · ${formatMoney(data.bests.revenue.revenue)}`
    : NA_TEXT;
  element('year-worst-revenue').textContent = data.worsts.revenue
    ? `${MONTH_NAMES[data.worsts.revenue.month - 1]} · ${formatMoney(data.worsts.revenue.revenue)}`
    : NA_TEXT;
  element('year-best-completion').textContent = data.bests.completion
    ? `${MONTH_NAMES[data.bests.completion.month - 1]} · ${formatPercent(data.bests.completion.planCompletion)}`
    : NA_TEXT;
  element('year-worst-completion').textContent = data.worsts.completion
    ? `${MONTH_NAMES[data.worsts.completion.month - 1]} · ${formatPercent(data.worsts.completion.planCompletion)}`
    : NA_TEXT;
  element('year-table-year-label').textContent = String(data.year);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const body = element('year-months-table');
  body.replaceChildren();
  const labels = [];
  const revenue = [];
  const plan = [];
  const average = [];
  const changes = [];
  for (const month of data.months) {
    if (month.dataStatus === 'NO_DATA') continue;
    const isCurrent = data.year === currentYear && month.month === currentMonth;
    const label = isCurrent ? `${MONTH_NAMES[month.month - 1]} · Текущий месяц` : MONTH_NAMES[month.month - 1];
    labels.push(label);
    revenue.push(month.revenue);
    plan.push(month.plan);
    average.push(month.averageCheck);
    changes.push(month.changeFromPreviousMonth || 0);
    const row = document.createElement('tr');
    if (isCurrent) row.classList.add('current-row');
    appendCell(row, label);
    appendCell(row, formatMoney(month.plan), 'numeric');
    appendCell(row, formatMoney(month.revenue), 'numeric');
    appendCell(row, formatPercent(month.planCompletion), 'numeric');
    appendCell(row, formatInteger(month.receipts), 'numeric');
    appendCell(row, formatMoney(month.averageCheck), 'numeric');
    appendCell(row, formatInteger(month.shiftsCount), 'numeric');
    const change = month.changeFromPreviousMonth;
    appendCell(row, change === null ? '—' : `${change >= 0 ? '+' : ''}${formatMoney(change)}${isCurrent ? ' (месяц не завершён)' : ''}`, 'numeric');
    body.append(row);
  }
  renderBarChart('year-chart-revenue', labels, [
    { label: 'План', values: plan, color: THEME_COLORS.borderStrong },
    { label: 'Факт', values: revenue, color: THEME_COLORS.primary },
  ], formatMoneyAxis);
  renderLineChart('year-chart-average', labels, [average], ['Средний чек'], [THEME_COLORS.accent], formatMoneyAxis, formatMoney);
  renderBarChart('year-chart-mom', labels, [
    { label: 'Δ к прошлому месяцу', values: changes, color: THEME_COLORS.primary },
  ], formatMoneyAxis);
}

async function loadYear() {
  const store = selectedStoreId();
  if (!store) return;
  const year = selectedYear();
  renderYear(await api(
    `/api/business-kpi/year?store=${encodeURIComponent(store)}&year=${year}`
  ));
}

function renderBonuses(data) {
  state.bonuses = data;
  setPill('bonuses-status', data.dataStatus);
  const body = element('bonuses-table');
  body.replaceChildren();
  element('bonuses-empty').hidden = data.items.length !== 0;
  for (const item of data.items) {
    const row = document.createElement('tr');
    const shiftNormText = item.shiftNorm ? formatInteger(item.shiftNorm) : '—';
    const shiftCoefficient = item.bonusDetails
      ? item.bonusDetails.shiftCoefficient
      : (item.shiftNorm ? Math.min(1, item.shiftsCount / item.shiftNorm) : null);

    appendCell(row, item.employeeName || NA_TEXT);
    appendCell(row, kpiLabel(item.averageKpi, item.kpiLevel), 'numeric');
    appendCell(row, item.kpiLevel || NA_TEXT);
    appendCell(row, item.bonusDetails ? formatMoney(item.bonusDetails.bonusBase) : NA_TEXT, 'numeric');
    appendCell(row, `${formatInteger(item.shiftsCount)} / ${shiftNormText}`, 'numeric');
    appendCell(row, shiftCoefficient !== null ? formatNumber(shiftCoefficient) : NA_TEXT, 'numeric');
    appendCell(row, formatPercent(item.qrShare), 'numeric');
    appendCell(row, item.bonusDetails ? formatNumber(item.bonusDetails.qrCoefficient) : NA_TEXT, 'numeric');
    appendCell(row, item.bonusStatus === 'COMPLETE' ? formatMoney(item.bonus)
      : (item.bonusStatus === 'ACCESS_DENIED' ? 'Недоступно' : NA_TEXT), 'numeric');

    const detailsCell = document.createElement('td');
    detailsCell.className = 'action-column';
    if (item.bonusStatus === 'ACCESS_DENIED') {
      detailsCell.textContent = 'Нет доступа';
    } else if (item.bonusDetails) {
      const formula = `${formatMoney(item.bonusDetails.bonusBase)} × ${formatNumber(item.bonusDetails.shiftCoefficient)} × ${formatNumber(item.bonusDetails.qrCoefficient)} = ${formatMoney(item.bonus)}`;
      const expand = document.createElement('button');
      expand.type = 'button';
      expand.className = 'table-button';
      expand.textContent = 'Подробнее';
      expand.addEventListener('click', () => {
        const existing = row.nextElementSibling;
        if (existing?.classList.contains('bonus-details-row')) {
          existing.remove();
          return;
        }
        const detailsRow = document.createElement('tr');
        detailsRow.className = 'bonus-details-row';
        const details = document.createElement('td');
        details.colSpan = 10;
        details.className = 'bonus-formula';
        details.textContent = formula;
        detailsRow.append(details);
        row.after(detailsRow);
      });
      detailsCell.append(expand);
    } else {
      const reason = document.createElement('span');
      reason.className = 'bonus-unresolved-reason';
      if (item.missingFields?.length) {
        reason.textContent = `Нет данных: ${item.missingFields.map(russianMissingField).join(', ')}`;
      } else if (item.shiftNorm && item.shiftsCount < item.shiftNorm) {
        reason.textContent = `Мало смен: ${item.shiftsCount} из ${item.shiftNorm}`;
      } else {
        reason.textContent = 'Расчёт недоступен';
      }
      detailsCell.append(reason);
    }
    row.append(detailsCell);
    body.append(row);
  }
}

async function loadBonuses() {
  const store = selectedStoreId();
  if (!store) return;
  const { year, month } = period();
  const [bonuses, dashboard] = await Promise.all([
    api(`/api/business-kpi/bonuses?store=${encodeURIComponent(store)}&year=${year}&month=${month}`),
    api(`/api/business-kpi/dashboard?store=${encodeURIComponent(store)}&year=${year}&month=${month}`),
  ]);
  const missingFieldsByEmployee = new Map((dashboard.sellers || []).map(s => [s.employeeId, s.missingFields || []]));
  for (const item of bonuses.items) {
    item.missingFields = missingFieldsByEmployee.get(item.employeeId) || [];
  }
  renderBonuses(bonuses);
}

function renderSettings(record) {
  state.settings = record.settings;
  const list = element('settings-list');
  list.replaceChildren();
  const settings = record.settings;
  const entries = [
    ['Версия', record.version],
    ['Действует с', formatDate(record.effectiveFrom)],
    ['Цель среднего чека', formatMoney(settings.targets.averageCheck)],
    ['Цель товаров в чеке', formatNumber(settings.targets.itemsPerReceipt)],
    ['Цель допродаж', formatPercent(settings.targets.upsellReceiptShare)],
    ['Цель лакомств за смену', formatMoney(settings.targets.treatsRevenue)],
    ['Цель чеков с лакомствами', formatPercent(settings.targets.treatsReceiptShare)],
    ['Цель QR', settings.targets.qrShare === null ? NA_TEXT : formatPercent(settings.targets.qrShare)],
    ['Цель смены', formatMoney(settings.targets.shiftRevenue)],
    ['Норма смен продавца', formatInteger(settings.targets.sellerShifts)],
    ['Комиссия эквайринга', formatPercent(settings.fees.acquiring)],
    ['Комиссия QR', formatPercent(settings.fees.qr)],
    ['QR входит в эквайринг', settings.payment.qrIncludedInAcquiring ? 'Да' : 'Нет'],
    ['Вес плана смены', formatInteger(settings.weights.shiftPlan)],
    ['Вес среднего чека', formatInteger(settings.weights.averageCheck)],
    ['Вес товаров в чеке', formatInteger(settings.weights.itemsPerReceipt)],
    ['Вес допродаж', formatInteger(settings.weights.upsell)],
    ['Вес лакомств', formatInteger(settings.weights.treats)],
    ['Уровни', settings.levels.map(level => `${level.minimumScore}+ → ${level.name}: ${formatMoney(level.bonusBase)}`).join('; ')],
  ];
  for (const [name, value] of entries) {
    const term = document.createElement('dt');
    term.textContent = name;
    const detail = document.createElement('dd');
    detail.textContent = value;
    list.append(term, detail);
  }
  populateSettingsEditor(record.settings);
}

function populateSettingsEditor(settings) {
  element('settings-average-check').value = settings.targets.averageCheck ?? '';
  element('settings-items-per-receipt').value = settings.targets.itemsPerReceipt ?? '';
  element('settings-upsell-share').value = percentInput(settings.targets.upsellReceiptShare);
  element('settings-treats-revenue').value = settings.targets.treatsRevenue ?? '';
  element('settings-treats-share').value = percentInput(settings.targets.treatsReceiptShare);
  element('settings-qr-share').value = percentInput(settings.targets.qrShare);
  element('settings-shift-revenue').value = settings.targets.shiftRevenue ?? '';
  element('settings-seller-shifts').value = settings.targets.sellerShifts ?? '';
  element('settings-acquiring-fee').value = percentInput(settings.fees.acquiring);
  element('settings-qr-fee').value = percentInput(settings.fees.qr);
  element('settings-qr-included').value = String(settings.payment.qrIncludedInAcquiring);
  element('settings-weight-shift').value = settings.weights.shiftPlan ?? '';
  element('settings-weight-average').value = settings.weights.averageCheck ?? '';
  element('settings-weight-items').value = settings.weights.itemsPerReceipt ?? '';
  element('settings-weight-upsell').value = settings.weights.upsell ?? '';
  element('settings-weight-treats').value = settings.weights.treats ?? '';
  renderSettingsLevels(settings.levels);
  renderSettingsQrTiers(settings.qrCoefficientTiers);
  updateWeightSum();
}

function renderSettingsLevels(levels) {
  const container = element('settings-levels');
  container.replaceChildren();
  for (const level of levels) {
    const div = document.createElement('div');
    div.className = 'form-grid three';
    div.innerHTML = `
      <label>Название<input type="text" class="level-name" value="${level.name}" required></label>
      <label>Минимальный KPI<input type="number" class="level-score" min="0" max="100" step="0.01" value="${level.minimumScore}" required></label>
      <label>База премии, ₽<input type="number" class="level-base" min="0" step="0.01" value="${level.bonusBase}" required></label>
    `;
    container.append(div);
  }
}

function renderSettingsQrTiers(tiers) {
  const container = element('settings-qr-tiers');
  container.replaceChildren();
  let previousPercent = 0;
  for (let index = 0; index < tiers.length; index += 1) {
    const tier = tiers[index];
    const upperPercent = tier.upperExclusive === null ? null : percentInput(tier.upperExclusive);
    const isLast = index === tiers.length - 1;
    const rangeLabel = isLast
      ? `от ${formatPercent(previousPercent / 100)} и выше`
      : (index === 0
        ? `до ${formatPercent(tier.upperExclusive)}`
        : `${formatPercent(previousPercent / 100)} – ${formatPercent(tier.upperExclusive)}`);
    const div = document.createElement('div');
    div.className = 'form-grid qr-tier-row';
    div.dataset.index = index;
    div.innerHTML = `
      <span class="qr-tier-range">${rangeLabel}</span>
      <label>Верхняя граница, %<input type="number" class="qr-upper" min="0" max="100" step="0.1" value="${upperPercent === null ? '' : upperPercent}" ${isLast ? '' : 'required'}></label>
      <span class="qr-tier-times">→ ×</span>
      <label>Коэффициент<input type="number" class="qr-coef" min="0" step="0.001" value="${tier.coefficient}" required></label>
    `;
    container.append(div);
    if (upperPercent !== null) previousPercent = upperPercent;
  }
}

function readSettingsForm() {
  return {
    targets: {
      averageCheck: Number(element('settings-average-check').value),
      itemsPerReceipt: Number(element('settings-items-per-receipt').value),
      upsellReceiptShare: percentValue(element('settings-upsell-share').value),
      treatsRevenue: Number(element('settings-treats-revenue').value),
      treatsReceiptShare: percentValue(element('settings-treats-share').value),
      qrShare: percentValue(element('settings-qr-share').value),
      shiftRevenue: Number(element('settings-shift-revenue').value),
      sellerShifts: Number(element('settings-seller-shifts').value),
    },
    weights: {
      shiftPlan: Number(element('settings-weight-shift').value),
      averageCheck: Number(element('settings-weight-average').value),
      itemsPerReceipt: Number(element('settings-weight-items').value),
      upsell: Number(element('settings-weight-upsell').value),
      treats: Number(element('settings-weight-treats').value),
    },
    fees: {
      acquiring: percentValue(element('settings-acquiring-fee').value),
      qr: percentValue(element('settings-qr-fee').value),
    },
    payment: {
      qrIncludedInAcquiring: element('settings-qr-included').value === 'true',
    },
    levels: Array.from(element('settings-levels').children).map(div => ({
      name: div.querySelector('.level-name').value,
      minimumScore: Number(div.querySelector('.level-score').value),
      bonusBase: Number(div.querySelector('.level-base').value),
    })),
    qrCoefficientTiers: Array.from(element('settings-qr-tiers').children).map(div => ({
      upperExclusive: percentValue(div.querySelector('.qr-upper').value),
      coefficient: Number(div.querySelector('.qr-coef').value),
    })),
  };
}

function validateSettingsForm() {
  const errors = [];
  const s = readSettingsForm();

  function checkFinite(value, name) {
    if (!Number.isFinite(value)) errors.push(`${name}: введите корректное число.`);
    else if (value < 0) errors.push(`${name}: значение не может быть отрицательным.`);
  }

  checkFinite(s.targets.averageCheck, 'Цель среднего чека');
  checkFinite(s.targets.itemsPerReceipt, 'Цель товаров в чеке');
  checkFinite(s.targets.upsellReceiptShare, 'Цель допродаж');
  if (Number.isFinite(s.targets.upsellReceiptShare) && s.targets.upsellReceiptShare > 1) {
    errors.push('Цель допродаж не может превышать 100%.');
  }
  checkFinite(s.targets.treatsRevenue, 'Цель лакомств за смену');
  checkFinite(s.targets.treatsReceiptShare, 'Цель чеков с лакомствами');
  if (Number.isFinite(s.targets.treatsReceiptShare) && s.targets.treatsReceiptShare > 1) {
    errors.push('Цель чеков с лакомствами не может превышать 100%.');
  }
  if (s.targets.qrShare !== null) {
    checkFinite(s.targets.qrShare, 'Цель QR');
    if (Number.isFinite(s.targets.qrShare) && s.targets.qrShare > 1) {
      errors.push('Цель QR не может превышать 100%.');
    }
  }
  checkFinite(s.targets.shiftRevenue, 'Цель смены');
  checkFinite(s.targets.sellerShifts, 'Норма смен продавца');

  checkFinite(s.fees.acquiring, 'Комиссия эквайринга');
  if (Number.isFinite(s.fees.acquiring) && s.fees.acquiring > 1) {
    errors.push('Комиссия эквайринга не может превышать 100%.');
  }
  checkFinite(s.fees.qr, 'Комиссия QR');
  if (Number.isFinite(s.fees.qr) && s.fees.qr > 1) {
    errors.push('Комиссия QR не может превышать 100%.');
  }

  Object.entries(s.weights).forEach(([key, value]) => {
    checkFinite(value, `Вес ${key}`);
    if (Number.isFinite(value) && value > 100) errors.push(`Вес ${key} не может превышать 100.`);
  });
  const weightSum = Object.values(s.weights).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  if (Math.abs(weightSum - 100) > 0.001) {
    errors.push(`Сумма весов KPI должна быть 100 (сейчас ${weightSum}).`);
  }

  for (let i = 0; i < s.levels.length; i += 1) {
    const level = s.levels[i];
    if (!level.name.trim()) errors.push(`Уровень ${i + 1}: название обязательно.`);
    checkFinite(level.minimumScore, `Уровень ${i + 1}: минимальный KPI`);
    if (Number.isFinite(level.minimumScore) && level.minimumScore > 100) {
      errors.push(`Уровень ${i + 1}: минимальный KPI не может превышать 100.`);
    }
    checkFinite(level.bonusBase, `Уровень ${i + 1}: база премии`);
  }

  let previousUpper = -1;
  for (let i = 0; i < s.qrCoefficientTiers.length; i += 1) {
    const tier = s.qrCoefficientTiers[i];
    const isLast = i === s.qrCoefficientTiers.length - 1;
    if (!isLast) {
      checkFinite(tier.upperExclusive, `QR tier ${i + 1}: верхняя граница`);
      if (Number.isFinite(tier.upperExclusive)) {
        if (tier.upperExclusive > 1) errors.push(`QR tier ${i + 1}: граница не может превышать 100%.`);
        if (tier.upperExclusive <= previousUpper) {
          errors.push(`QR tier ${i + 1}: границы должны идти по возрастанию.`);
        }
      }
      previousUpper = tier.upperExclusive;
    }
    checkFinite(tier.coefficient, `QR tier ${i + 1}: коэффициент`);
  }

  const effectiveFrom = element('settings-effective-from').value;
  if (!effectiveFrom) errors.push('Укажите дату начала действия версии.');
  if (!element('settings-reason').value.trim()) errors.push('Укажите причину изменения настроек.');

  return errors;
}

function updateQrTierRanges() {
  const rows = Array.from(element('settings-qr-tiers').children);
  let previousPercent = 0;
  rows.forEach((row, index) => {
    const upperInput = row.querySelector('.qr-upper');
    const rangeLabel = row.querySelector('.qr-tier-range');
    const upperPercent = upperInput.value === '' ? null : Number(upperInput.value);
    const isLast = index === rows.length - 1;
    if (isLast) {
      rangeLabel.textContent = `от ${formatPercent(previousPercent / 100)} и выше`;
    } else if (index === 0) {
      rangeLabel.textContent = upperPercent === null ? 'до —' : `до ${formatPercent(upperPercent / 100)}`;
    } else {
      rangeLabel.textContent = upperPercent === null
        ? `${formatPercent(previousPercent / 100)} – —`
        : `${formatPercent(previousPercent / 100)} – ${formatPercent(upperPercent / 100)}`;
    }
    if (upperPercent !== null) previousPercent = upperPercent;
  });
}

function updateWeightSum() {
  const weights = readSettingsForm().weights;
  const sum = Object.values(weights).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
  const status = element('settings-weight-status');
  status.textContent = `Сумма весов: ${sum} / 100`;
  status.className = classNames('status-pill', Math.abs(sum - 100) > 0.001 ? 'warn' : '');
  return sum;
}

async function loadSettings() {
  const { year, month } = period();
  const date = `${year}-${String(month).padStart(2, '0')}-01`;
  const store = selectedStoreId();
  renderSettings(await api(`/api/business-kpi/settings?store=${encodeURIComponent(store)}&date=${date}`));
  await loadSettingsVersions();
}

async function loadSettingsVersions() {
  const store = selectedStoreId();
  const { year, month } = period();
  const date = `${year}-${String(month).padStart(2, '0')}-01`;
  const data = await api(`/api/business-kpi/settings/versions?store=${encodeURIComponent(store)}&date=${date}`);
  const body = element('settings-versions-table');
  body.replaceChildren();
  element('settings-versions-empty').hidden = data.items.length !== 0;
  for (const version of data.items) {
    const row = document.createElement('tr');
    appendCell(row, version.version, 'numeric');
    appendCell(row, formatDate(version.effectiveFrom));
    appendCell(row, version.source);
    const actionCell = document.createElement('td');
    const useBtn = document.createElement('button');
    useBtn.type = 'button';
    useBtn.className = 'table-button';
    useBtn.textContent = 'Загрузить';
    useBtn.addEventListener('click', () => {
      populateSettingsEditor(version.settings);
      element('settings-effective-from').value = version.effectiveFrom;
    });
    actionCell.append(useBtn);
    row.append(actionCell);
    body.append(row);
  }
}

let pendingSettingsPayload = null;

function formatSettingsDiff(current, next) {
  const diffs = [];
  const fmt = (v) => (v === null || v === undefined ? 'не задано' : v);
  const fmtPct = (v) => (Number.isFinite(v) ? `${(v * 100).toFixed(1).replace(/\.0$/, '')}%` : fmt(v));
  const fmtMoney = (v) => (Number.isFinite(v) ? `${v.toFixed(2).replace(/\.(\d+)0+$/, '.$1')} ₽` : fmt(v));

  if (current.targets.averageCheck !== next.targets.averageCheck) {
    diffs.push(`Цель среднего чека: ${fmtMoney(current.targets.averageCheck)} → ${fmtMoney(next.targets.averageCheck)}`);
  }
  if (current.targets.itemsPerReceipt !== next.targets.itemsPerReceipt) {
    diffs.push(`Цель товаров в чеке: ${fmt(current.targets.itemsPerReceipt)} → ${fmt(next.targets.itemsPerReceipt)}`);
  }
  if (current.targets.upsellReceiptShare !== next.targets.upsellReceiptShare) {
    diffs.push(`Цель допродаж: ${fmtPct(current.targets.upsellReceiptShare)} → ${fmtPct(next.targets.upsellReceiptShare)}`);
  }
  if (current.targets.treatsRevenue !== next.targets.treatsRevenue) {
    diffs.push(`Цель лакомств за смену: ${fmtMoney(current.targets.treatsRevenue)} → ${fmtMoney(next.targets.treatsRevenue)}`);
  }
  if (current.targets.treatsReceiptShare !== next.targets.treatsReceiptShare) {
    diffs.push(`Цель чеков с лакомствами: ${fmtPct(current.targets.treatsReceiptShare)} → ${fmtPct(next.targets.treatsReceiptShare)}`);
  }
  if (current.targets.shiftRevenue !== next.targets.shiftRevenue) {
    diffs.push(`Цель смены: ${fmtMoney(current.targets.shiftRevenue)} → ${fmtMoney(next.targets.shiftRevenue)}`);
  }
  if (current.targets.sellerShifts !== next.targets.sellerShifts) {
    diffs.push(`Норма смен: ${fmt(current.targets.sellerShifts)} → ${fmt(next.targets.sellerShifts)}`);
  }
  if (current.fees.acquiring !== next.fees.acquiring) {
    diffs.push(`Комиссия эквайринга: ${fmtPct(current.fees.acquiring)} → ${fmtPct(next.fees.acquiring)}`);
  }
  if (current.fees.qr !== next.fees.qr) {
    diffs.push(`Комиссия QR: ${fmtPct(current.fees.qr)} → ${fmtPct(next.fees.qr)}`);
  }

  const weightKeys = ['shiftPlan', 'averageCheck', 'itemsPerReceipt', 'upsell', 'treats'];
  weightKeys.forEach((key) => {
    if (current.weights[key] !== next.weights[key]) {
      diffs.push(`Вес ${key}: ${fmt(current.weights[key])} → ${fmt(next.weights[key])}`);
    }
  });

  return diffs;
}

function showSettingsConfirm(payload) {
  pendingSettingsPayload = payload;
  const dialog = element('settings-confirm-dialog');
  element('settings-confirm-message').textContent =
    `Новая версия нормативов начнёт действовать с ${formatDate(payload.effectiveFrom)}. Исторические расчёты до этой даты не изменятся.`;
  const diffs = formatSettingsDiff(state.settings, payload.settings);
  const diffContainer = element('settings-confirm-diff');
  if (diffs.length === 0) {
    diffContainer.innerHTML = '<p>Изменённых параметров нет.</p>';
  } else {
    diffContainer.innerHTML = '<ul>' + diffs.map(d => `<li>${d}</li>`).join('') + '</ul>';
  }
  dialog.showModal();
}

async function submitSettingsFromDialog() {
  const dialog = element('settings-confirm-dialog');
  dialog.close();
  if (!pendingSettingsPayload) return;
  const errorBox = element('settings-error');
  errorBox.hidden = true;
  try {
    await api('/api/business-kpi/settings', {
      method: 'POST',
      body: JSON.stringify(pendingSettingsPayload),
    });
    element('settings-reason').value = '';
    pendingSettingsPayload = null;
    showMessage('Новая версия настроек KPI создана.');
    await loadSettings();
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
}

async function saveSettings(event) {
  event.preventDefault();
  const errorBox = element('settings-error');
  errorBox.hidden = true;
  updateWeightSum();
  const errors = validateSettingsForm();
  if (errors.length > 0) {
    errorBox.innerHTML = errors.map(e => `• ${e}`).join('<br>');
    errorBox.hidden = false;
    return;
  }
  const store = selectedStoreId();
  const effectiveFrom = element('settings-effective-from').value;
  const reason = element('settings-reason').value;
  showSettingsConfirm({
    storeId: store,
    effectiveFrom,
    reason,
    settings: readSettingsForm(),
  });
}

async function renderRoute() {
  const routeId = selectedRoute();
  if (!canViewRoute(routeId)) {
    window.location.hash = '#dashboard';
    return;
  }
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
  document.querySelector(`[data-panel="${routeId}"]`).hidden = false;
  element('open-shift-form').hidden =
    (routeId !== 'dashboard' && routeId !== 'shifts') || !canCreateShift();
  element('month-filter-field').hidden = routeId === 'year';
  element('year-filter-field').hidden = routeId !== 'year' && routeId !== 'months';
  element('seller-detail-card').hidden = true;
  try {
    if (routeId === 'dashboard' || routeId === 'sellers' || routeId === 'bonuses') {
      await loadEffectiveSettings();
    }
    if (routeId === 'dashboard') await loadDashboard();
    if (routeId === 'shifts') await loadShifts();
    if (routeId === 'months') await loadMonths();
    if (routeId === 'year') await loadYear();
    if (routeId === 'sellers') {
      await loadDashboard();
      renderSellers(state.dashboard.sellers);
    }
    if (routeId === 'bonuses') await loadBonuses();
    if (routeId === 'settings') await loadSettings();
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

function validateShiftInput(payload) {
  const errors = [];
  if (payload.cash !== null && payload.cash < 0) errors.push('Наличные не могут быть отрицательными.');
  if (payload.acquiring !== null && payload.acquiring < 0) errors.push('Эквайринг не может быть отрицательным.');
  if (payload.qr !== null && payload.qr < 0) errors.push('QR не может быть отрицательным.');
  if (payload.receipts !== null && payload.receipts < 0) errors.push('Чеки не могут быть отрицательными.');
  if (payload.itemsSold !== null && payload.itemsSold < 0) errors.push('Товарные единицы не могут быть отрицательными.');
  if (payload.upsellReceipts !== null && payload.upsellReceipts < 0) errors.push('Чеки с допродажей не могут быть отрицательными.');
  if (payload.treatsRevenue !== null && payload.treatsRevenue < 0) errors.push('Лакомства не могут быть отрицательными.');
  if (payload.treatsReceipts !== null && payload.treatsReceipts < 0) errors.push('Чеки с лакомствами не могут быть отрицательными.');
  if (payload.qr !== null && payload.acquiring !== null && payload.qr > payload.acquiring) {
    errors.push('QR не может быть больше эквайринга, который уже включает QR.');
  }
  if (payload.upsellReceipts !== null && payload.receipts !== null && payload.upsellReceipts > payload.receipts) {
    errors.push('Чеки с допродажей не могут превышать общее количество чеков.');
  }
  if (payload.treatsReceipts !== null && payload.receipts !== null && payload.treatsReceipts > payload.receipts) {
    errors.push('Чеки с лакомствами не могут превышать общее количество чеков.');
  }
  return errors;
}

function updatePreview() {
  if (element('shift-cash').readOnly) return;
  const cash = numberInput('shift-cash');
  const acquiring = numberInput('shift-acquiring');
  const qr = numberInput('shift-qr');
  const receipts = numberInput('shift-receipts');
  const items = numberInput('shift-items');
  const upsells = numberInput('shift-upsells');
  const treatsRevenue = numberInput('shift-treats-revenue');
  const treatsReceipts = numberInput('shift-treats-receipts');
  const revenue = cash === null || acquiring === null ? null : cash + acquiring;
  const error = element('shift-error');
  const payload = shiftPayload();
  const errors = validateShiftInput(payload);
  if (errors.length > 0) {
    error.textContent = errors[0];
    error.hidden = false;
  } else if (error.dataset.server !== 'true') {
    error.hidden = true;
  }
  element('preview-revenue').textContent = formatMoney(revenue);
  element('preview-average').textContent = receipts > 0 && revenue !== null
    ? formatMoney(revenue / receipts)
    : UNAVAILABLE;
  element('preview-items').textContent = receipts > 0 && items !== null
    ? formatNumber(items / receipts)
    : UNAVAILABLE;
  element('preview-qr').textContent = revenue !== null && revenue > 0 && qr !== null
    ? formatPercent(qr / revenue)
    : UNAVAILABLE;
  element('preview-upsells').textContent = receipts > 0 && upsells !== null
    ? formatPercent(upsells / receipts)
    : UNAVAILABLE;
  element('preview-treats').textContent = receipts > 0 && treatsReceipts !== null
    ? formatPercent(treatsReceipts / receipts)
    : UNAVAILABLE;
  element('preview-kpi').textContent = UNAVAILABLE;
}

function setFormValue(id, value) {
  const el = element(id);
  if (value === null || value === undefined) el.value = '';
  else if (el.type === 'number') el.value = String(value);
  else el.value = value;
}

function renderAudit(items = []) {
  const section = element('shift-audit-section');
  const list = element('shift-audit-list');
  list.replaceChildren();
  section.hidden = items.length === 0;
  for (const item of items) {
    const row = document.createElement('li');
    const occurred = new Date(item.occurredAt).toLocaleString('ru-RU');
    row.textContent = `${occurred} · ${item.action}${item.reason ? ` · ${item.reason}` : ''}`;
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
    ? `Источник: ${sourceLabel(shift.source)}${shift.override ? ' · есть ручной override' : ''}`
    : '';
  const historical = shift?.revenueSource === 'historical_total';
  const editable = shift ? canEditShift(shift) : canCreateShift();
  const isSeller = state.currentUser?.role === 'SELLER';
  element('archive-shift').hidden = !canArchiveShift(shift);
  element('save-shift').hidden = !editable;
  element('shift-employee').disabled = Boolean(shift) || isSeller;
  element('shift-store').disabled = isSeller;
  for (const id of ['shift-cash', 'shift-acquiring', 'shift-qr', 'shift-receipts',
    'shift-items', 'shift-upsells', 'shift-treats-revenue', 'shift-treats-receipts',
    'shift-comment', 'shift-key', 'shift-date']) {
    element(id).readOnly = historical || !editable;
  }
  setFormValue('shift-date', shift?.shiftDate || new Date().toISOString().slice(0, 10));
  setFormValue('shift-store', shift?.storeId || selectedStoreId());
  setFormValue('shift-employee', shift?.employeeId || (isSeller ? state.currentUser?.employeeId : state.employees[0]?.id) || '');
  setFormValue('shift-key', shift?.shiftKey || 'main');
  setFormValue('shift-cash', historical ? null : shift?.cash);
  setFormValue('shift-acquiring', historical ? null : shift?.acquiring);
  setFormValue('shift-qr', historical ? null : shift?.qr);
  setFormValue('shift-receipts', shift?.receipts);
  setFormValue('shift-items', shift?.itemsSold);
  setFormValue('shift-upsells', shift?.upsellReceipts);
  setFormValue('shift-treats-revenue', shift?.treatsRevenue);
  setFormValue('shift-treats-receipts', shift?.treatsReceipts);
  setFormValue('shift-comment', shift?.comment || '');
  renderAudit(shift?.audit || []);
  updatePreview();
  if (historical) {
    element('preview-revenue').textContent = formatMoney(shift.metrics?.revenue);
    element('preview-average').textContent = formatMoney(shift.metrics?.averageCheck);
    element('preview-items').textContent = formatNumber(shift.metrics?.itemsPerReceipt);
  }
  dialog.showModal();
  element('shift-date').focus();
}

function showShiftSummary(shift) {
  const dialog = element('shift-summary-dialog');
  const grid = element('shift-summary-grid');
  grid.replaceChildren();
  const items = [
    ['Дата', formatDate(shift.shiftDate)],
    ['Продавец', shift.employeeName || NA_TEXT],
    ['Магазин', state.stores.find(s => s.id === shift.storeId)?.name || NA_TEXT],
    ['Источник', sourceLabel(shift.source)],
    ['Выручка', formatMoney(shift.metrics?.revenue)],
    ['Чеки', formatInteger(shift.receipts)],
    ['Средний чек', formatMoney(shift.metrics?.averageCheck)],
    ['KPI', kpiLabel(shift.metrics?.kpiScore, shift.metrics?.kpiLevel)],
  ];
  for (const [label, value] of items) {
    const div = document.createElement('div');
    div.innerHTML = `<small>${label}</small><strong>${value}</strong>`;
    grid.append(div);
  }
  dialog.showModal();
}

function renderImportRun(run) {
  state.importRun = run;
  const report = run.report;
  const panel = element('import-report');
  panel.hidden = !report;
  if (!report) return;
  element('import-detected').textContent = report.detected
    ? `${String(report.detected.month).padStart(2, '0')}.${report.detected.year} · ${report.detected.version}`
    : UNAVAILABLE;
  element('import-store').textContent = report.store?.name || UNAVAILABLE;
  element('import-rows-read').textContent = formatInteger(report.rows?.read);
  element('import-rows-valid').textContent = formatInteger(report.rows?.valid);
  element('import-revenue').textContent = formatMoney(report.totals?.revenue);
  element('import-receipts').textContent = formatInteger(report.totals?.receipts);
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
    appendCell(row, formatDateTime(run.startedAt));
    const fileCell = document.createElement('td');
    fileCell.title = run.originalFilename || '';
    fileCell.textContent = shortenFilename(run.originalFilename);
    row.append(fileCell);
    appendCell(row, run.detectedYear ? `${String(run.detectedMonth).padStart(2, '0')}.${run.detectedYear}` : UNAVAILABLE);
    appendCell(row, uiImportStatus(run.status));
    appendCell(row, `${formatInteger(run.rowsImported)} / ${formatInteger(run.rowsRead)}`, 'numeric');
    appendCell(row, run.reconciliationStatus || UNAVAILABLE);
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
  element('selected-import-file').textContent = file ? shortenFilename(file.name) : 'Файл не выбран';
  element('selected-import-file').title = file ? file.name : '';
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
    showMessage(run.duplicate ? 'Этот файл уже импортирован: повторная запись не создана.' : 'Проверка завершена. Проверьте отчёт перед импортом.');
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
    showMessage('Исторические смены импортированы атомарно. Сверка: успешно.');
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
  const payload = shiftPayload();
  const errors = validateShiftInput(payload);
  if (errors.length > 0) {
    const errorBox = element('shift-error');
    errorBox.textContent = errors[0];
    errorBox.dataset.server = 'false';
    errorBox.hidden = false;
    return;
  }
  const id = element('shift-id').value;
  const errorBox = element('shift-error');
  element('save-shift').disabled = true;
  try {
    const result = await api(id ? `/api/business-kpi/shifts/${id}` : '/api/business-kpi/shifts', {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(payload),
    });
    element('shift-dialog').close();
    showMessage(id ? 'Смена обновлена. KPI пересчитаны.' : 'Смена создана. Dashboard обновлён.');
    await Promise.all([loadDashboard(), loadShifts()]);
    if (!id) showShiftSummary(result);
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

function populateYearFilter() {
  const select = element('year-filter');
  const current = new Date().getFullYear();
  select.replaceChildren();
  for (let y = current + 1; y >= current - 3; y -= 1) {
    const option = document.createElement('option');
    option.value = String(y);
    option.textContent = String(y);
    option.selected = y === current;
    select.append(option);
  }
}

function renderLineChart(containerId, labels, series, names, colors, axisFormatter = null, tooltipFormatter = null) {
  const container = element(containerId);
  if (!container) return;
  if (!labels.length) {
    container.innerHTML = '<p class="empty-copy">Нет данных для графика.</p>';
    return;
  }
  const width = 600;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const allValues = series.flat().filter(v => v !== null && v !== undefined);
  const formatter = axisFormatter || ((v) => formatNumber(v));
  const tipFormatter = tooltipFormatter || ((v) => formatNumber(v));
  let max = allValues.length ? Math.max(...allValues) : 0;
  let min = Math.min(0, ...allValues);
  if (allValues.length && max === min) {
    max = max * 1.2 || 1;
    min = min * 0.8;
  }
  const range = max - min || 1;
  const xStep = (width - padding.left - padding.right) / (labels.length - 1 || 1);
  const yScale = (height - padding.top - padding.bottom) / range;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  function x(i) { return padding.left + i * xStep; }
  function y(v) { return height - padding.bottom - (v - min) * yScale; }
  for (let i = 0; i <= 4; i += 1) {
    const value = min + (range * i) / 4;
    const yy = y(value);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', padding.left);
    line.setAttribute('x2', width - padding.right);
    line.setAttribute('y1', yy);
    line.setAttribute('y2', yy);
    line.setAttribute('stroke', THEME_COLORS.border);
    svg.append(line);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', padding.left - 8);
    text.setAttribute('y', yy + 4);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', THEME_COLORS.textSecondary);
    text.textContent = formatter(value);
    svg.append(text);
  }
  for (let i = 0; i < labels.length; i += Math.max(1, Math.floor(labels.length / 8))) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', x(i));
    text.setAttribute('y', height - 10);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', THEME_COLORS.textSecondary);
    text.textContent = labels[i];
    svg.append(text);
  }
  series.forEach((serie, idx) => {
    if (!serie.length) return;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let d = '';
    for (let i = 0; i < serie.length; i += 1) {
      if (serie[i] === null || serie[i] === undefined) continue;
      d += `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(serie[i])}`;
    }
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', colors[idx] || THEME_COLORS.primary);
    path.setAttribute('stroke-width', idx === 0 ? '2' : '1.5');
    path.setAttribute('stroke-dasharray', idx === 2 ? '4 2' : '');
    svg.append(path);

    for (let i = 0; i < serie.length; i += 1) {
      if (serie[i] === null || serie[i] === undefined) continue;
      const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      point.setAttribute('cx', x(i));
      point.setAttribute('cy', y(serie[i]));
      point.setAttribute('r', 3);
      point.setAttribute('fill', colors[idx] || THEME_COLORS.primary);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${labels[i]}: ${tipFormatter(serie[i])}`;
      point.append(title);
      svg.append(point);
    }
  });
  const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  names.forEach((name, idx) => {
    if (!series[idx]?.length) return;
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', width - padding.right - 120);
    rect.setAttribute('y', padding.top + idx * 16);
    rect.setAttribute('width', 10);
    rect.setAttribute('height', 10);
    rect.setAttribute('fill', colors[idx] || THEME_COLORS.primary);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', width - padding.right - 105);
    text.setAttribute('y', padding.top + idx * 16 + 9);
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', THEME_COLORS.textSecondary);
    text.textContent = name;
    g.append(rect, text);
    legend.append(g);
  });
  svg.append(legend);
  container.replaceChildren(svg);
}

function renderBarChart(containerId, labels, series, axisFormatter = null) {
  const container = element(containerId);
  if (!container) return;
  if (!labels.length) {
    container.innerHTML = '<p class="empty-copy">Нет данных для графика.</p>';
    return;
  }
  const width = 600;
  const height = 240;
  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const allValues = series.flatMap(s => s.values).filter(v => v !== null && v !== undefined);
  const formatter = axisFormatter || ((v) => formatMoney(v).replace(' ₽', ''));
  let max = allValues.length ? Math.max(...allValues) : 0;
  let min = Math.min(0, ...allValues);
  if (allValues.length && max === min) {
    max = max * 1.2 || 1;
    min = min * 0.8;
  }
  const range = max - min || 1;
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const groupWidth = plotWidth / labels.length;
  const barWidth = groupWidth / (series.length + 1);
  const yScale = plotHeight / range;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  function x(i) { return padding.left + i * groupWidth + groupWidth / 2 - (series.length * barWidth) / 2; }
  function y(v) { return height - padding.bottom - (v - min) * yScale; }
  const zeroY = y(0);
  const zeroLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  zeroLine.setAttribute('x1', padding.left);
  zeroLine.setAttribute('x2', width - padding.right);
  zeroLine.setAttribute('y1', zeroY);
  zeroLine.setAttribute('y2', zeroY);
  zeroLine.setAttribute('stroke', THEME_COLORS.border);
  svg.append(zeroLine);
  for (let i = 0; i <= 4; i += 1) {
    const value = min + (range * i) / 4;
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', padding.left - 8);
    text.setAttribute('y', y(value) + 4);
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', THEME_COLORS.textSecondary);
    text.textContent = formatter(value);
    svg.append(text);
  }
  for (let i = 0; i < labels.length; i += 1) {
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', padding.left + i * groupWidth + groupWidth / 2);
    text.setAttribute('y', height - 10);
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', THEME_COLORS.textSecondary);
    text.textContent = labels[i];
    svg.append(text);
  }
  series.forEach((serie, sIdx) => {
    serie.values.forEach((value, i) => {
      if (value === null || value === undefined) return;
      const bar = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
      const bx = x(i) + sIdx * barWidth;
      const by = y(value);
      bar.setAttribute('x', bx);
      bar.setAttribute('y', Math.min(by, zeroY));
      bar.setAttribute('width', barWidth - 2);
      bar.setAttribute('height', Math.abs(zeroY - by));
      bar.setAttribute('fill', serie.color);
      bar.setAttribute('rx', 2);
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${labels[i]}: ${formatMoney(value)}`;
      bar.append(title);
      svg.append(bar);
    });
  });
  const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  series.forEach((serie, idx) => {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', width - padding.right - 80);
    rect.setAttribute('y', padding.top + idx * 16);
    rect.setAttribute('width', 10);
    rect.setAttribute('height', 10);
    rect.setAttribute('fill', serie.color);
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', width - padding.right - 65);
    text.setAttribute('y', padding.top + idx * 16 + 9);
    text.setAttribute('font-size', '10');
    text.setAttribute('fill', THEME_COLORS.textSecondary);
    text.textContent = serie.label;
    g.append(rect, text);
    legend.append(g);
  });
  svg.append(legend);
  container.replaceChildren(svg);
}

function renderUserProfile() {
  const user = state.currentUser;
  const profile = element('user-profile');
  if (!user) {
    profile.hidden = true;
    return;
  }
  element('user-name').textContent = user.displayName || user.externalId;
  element('user-role').textContent = roleLabel(user.role);
  element('user-avatar').textContent = (user.displayName || user.externalId || '?').slice(0, 1).toUpperCase();
  profile.hidden = false;
}

function renderSidebar() {
  document.querySelectorAll('[data-route]').forEach(link => {
    const route = link.dataset.route;
    link.hidden = !canViewRoute(route);
  });
}

async function logout() {
  try {
    await api('/api/business-kpi/auth/logout', { method: 'POST' });
  } catch {
    // ignore
  }
  window.location.replace('/login.html');
}

async function initialize() {
  const now = new Date();
  element('period-filter').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  populateYearFilter();
  document.title = `${BUSINESS_CONTEXT.name} · ${BUSINESS_CONTEXT.moduleName}`;
  try {
    const user = await api('/api/business-kpi/auth/me');
    if (!user?.user) {
      redirectToLogin();
      return;
    }
    state.currentUser = user.user;
    document.body.classList.remove('auth-loading');
    renderUserProfile();
    renderSidebar();
    const health = await api('/health');
    const runtime = element('runtime-mode');
    const runtimeNote = element('runtime-note');
    if (health.mode === 'LOCAL_DEV') {
      runtime.textContent = 'Работает';
      runtimeNote.hidden = false;
    } else {
      runtime.textContent = 'Работает';
      runtimeNote.hidden = false;
    }
    await loadReferenceData();
    await renderRoute();
  } catch (error) {
    redirectToLogin();
  }
}

/* Re-validate session when the browser restores the page from bfcache,
   so that Back after logout does not show the authenticated shell. */
window.addEventListener('pageshow', async event => {
  if (!event.persisted) return;
  try {
    const user = await api('/api/business-kpi/auth/me');
    if (!user?.user) redirectToLogin();
  } catch {
    redirectToLogin();
  }
});

window.addEventListener('hashchange', renderRoute);
element('store-filter').addEventListener('change', async () => {
  await loadReferenceData(selectedStoreId());
  await renderRoute();
});
element('period-filter').addEventListener('change', renderRoute);
element('year-filter').addEventListener('change', renderRoute);
element('employee-filter').addEventListener('change', loadShifts);
element('source-filter').addEventListener('change', () => renderShifts(state.shifts));
element('data-status-filter').addEventListener('change', () => renderShifts(state.shifts));
element('shifts-sort').addEventListener('change', () => renderShifts(state.shifts));
element('open-shift-form').addEventListener('click', () => openShiftDialog());
element('close-shift-form').addEventListener('click', () => element('shift-dialog').close());
element('cancel-shift').addEventListener('click', () => element('shift-dialog').close());
element('archive-shift').addEventListener('click', archiveShift);
element('shift-form').addEventListener('submit', saveShift);
element('shift-form').addEventListener('input', () => {
  element('shift-error').dataset.server = 'false';
  updatePreview();
});
element('shift-dialog').addEventListener('keydown', event => {
  if (event.key === 'Escape') element('shift-dialog').close();
});
element('close-seller-detail').addEventListener('click', () => {
  element('seller-detail-card').hidden = true;
});
element('plan-form').addEventListener('submit', savePlan);
element('settings-form').addEventListener('submit', saveSettings);
element('settings-form').addEventListener('input', () => {
  updateWeightSum();
  if (event.target.closest('#settings-qr-tiers')) {
    updateQrTierRanges();
  }
});
element('confirm-settings-create').addEventListener('click', submitSettingsFromDialog);
element('cancel-settings-confirm').addEventListener('click', () => element('settings-confirm-dialog').close());
element('close-settings-confirm').addEventListener('click', () => element('settings-confirm-dialog').close());
element('settings-confirm-dialog').addEventListener('keydown', event => {
  if (event.key === 'Escape') event.currentTarget.close();
});
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
element('close-shift-summary').addEventListener('click', () => element('shift-summary-dialog').close());
element('shift-summary-ok').addEventListener('click', () => element('shift-summary-dialog').close());
element('logout-button').addEventListener('click', logout);
initialize();
