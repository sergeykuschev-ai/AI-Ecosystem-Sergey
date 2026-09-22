'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicRoot = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const javascript = fs.readFileSync(path.join(publicRoot, 'app.js'), 'utf8');
const { STATIC_FILES } = require('../http/static_handler');

test('manual shift form contains every confirmed primary Excel Input field', () => {
  for (const name of [
    'shiftDate',
    'storeId',
    'employeeId',
    'shiftKey',
    'cash',
    'acquiring',
    'qr',
    'receipts',
    'itemsSold',
    'upsellReceipts',
    'treatsRevenue',
    'treatsReceipts',
    'comment',
  ]) {
    assert.match(html, new RegExp(`name="${name}"`));
  }
  for (const derived of ['revenue', 'averageCheck', 'itemsPerReceipt', 'kpiScore']) {
    assert.doesNotMatch(html, new RegExp(`name="${derived}"`));
  }
});

test('browser save path calls CRUD API and refreshes dashboard and shifts', () => {
  assert.match(javascript, /\/api\/business-kpi\/shifts/);
  assert.match(javascript, /method: id \? 'PATCH' : 'POST'/);
  assert.match(javascript, /method: 'DELETE'/);
  assert.match(javascript, /Promise\.all\(\[loadDashboard\(\), loadShifts\(\)\]\)/);
  assert.match(javascript, /QR не может быть больше эквайринга/);
});

test('dashboard and sellers expose required labels without frontend KPI formulas', () => {
  for (const label of [
    'План',
    'Выручка',
    'Выполнение',
    'Чеки',
    'Средний чек',
    'Товаров в чеке',
    'Наличные',
    'Безнал / эквайринг',
    'Доля QR',
    'Количество смен',
    'История изменений',
  ]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(javascript, /seller\.bonus/);
  assert.doesNotMatch(javascript, /kpiScore\s*=/);
});

test('import/export UI requires dry-run before commit and exposes run history', () => {
  for (const id of [
    'import-dropzone', 'import-file', 'dry-run-import', 'commit-import',
    'import-report', 'import-runs-table', 'export-month',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(javascript, /FormData/);
  assert.match(javascript, /\/imports\/dry-run/);
  assert.match(javascript, /\/imports\/\$\{state\.importRun\.id\}\/commit/);
  assert.match(javascript, /dragover/);
  assert.match(javascript, /drop/);
});

test('portal branding follows selected store while preserving MISKA logo', () => {
  const css = fs.readFileSync(path.join(publicRoot, 'styles.css'), 'utf8');
  assert.match(html, /<title>Business Portal · KPI<\/title>/);
  assert.match(html, /id="brand-name"/);
  assert.match(javascript, /STORE_CONTEXTS/);
  assert.match(javascript, /amper:[\s\S]*Ампер/);
  assert.match(javascript, /ventil:[\s\S]*Вентиль/);
  assert.match(javascript, /applyStoreContext/);
  assert.match(css, /data-store-theme="amper"/);
  assert.match(css, /data-store-theme="ventil"/);
  assert.match(css, /--brand-primary:/);
});

test('shifts KPI badge is rendered as HTML, not escaped raw markup', () => {
  assert.match(javascript, /function appendKpiCell\(/);
  assert.match(javascript, /appendKpiCell\(row, shift\.metrics\?\.kpiScore, shift\.metrics\?\.kpiLevel, 'numeric'\)/);
  assert.doesNotMatch(javascript, /appendCell\(row, kpiWithBadge\(/);
});

test('official MISKA logo asset is referenced, stored, and served by static handler', () => {
  assert.match(html, /assets\/miska-logo\.jpg/);
  assert.ok(fs.existsSync(path.join(publicRoot, 'assets', 'miska-logo.jpg')), 'logo asset exists in public/assets');
  assert.ok(STATIC_FILES['/assets/miska-logo.jpg'], 'logo route is registered in static handler');
  assert.equal(STATIC_FILES['/assets/miska-logo.jpg'][1], 'image/jpeg');
});

test('index.html references app.js with a cache-bust version and shows a permanent seller picker', () => {
  assert.match(html, /<script src="\/app\.js\?v=[0-9A-Za-z-]+" defer><\/script>/);
  assert.match(html, /<select id="task-seller-pick">/);
  assert.doesNotMatch(html, /task-seller-pick-field/);
});

test('generate flow always sends the picked seller and requires one when unknown', () => {
  assert.match(javascript, /seller-tasks\/shift-seller/);
  assert.match(javascript, /refreshShiftSellerPick/);
  assert.match(javascript, /Выберите продавца на смену/);
  assert.match(javascript, /shiftDate, employeeId/);
  assert.doesNotMatch(javascript, /sellerResolved === false[\s\S]{0,200}Сформировано предложений/);
});

test('sellers table preserves all business columns', () => {
  for (const label of [
    'Продавец', 'Смены', 'На смену', 'Цель на смену', 'Средний чек', 'Цель ср. чек',
    'Товаров в чеке', 'Цель товаров', 'Доля QR', 'KPI', 'Уровень', 'Бонус',
  ]) {
    assert.match(html, new RegExp(label));
  }
});

test('shift form uses store code to keep Miska KPI fields and hide them for other stores', () => {
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  assert.match(app, /state\.stores\.find\(item => item\.id === storeId\)/);
  assert.match(app, /store\?\.code === 'miska'/);
  assert.match(html, /id="shift-kpi-fieldset"/);
  assert.match(html, /data-miska-kpi-preview/);
});

test('non-Miska dashboard exposes unresolved store bonus without seller performance', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(html, /id="metric-store-bonus-card" hidden/);
  assert.match(app, /selectedStore\(\)\?\.code === 'miska'/);
  assert.match(app, /storeBonus\.amount === null \? 'Не настроена'/);
});

test('Amper and Ventil navigation is store-centric and premium page does not use seller formula', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(html, /id="store-bonus-panel" hidden/);
  assert.match(app, /return !\['sellers', 'tasks', 'import-export'\]\.includes\(route\)/);
  assert.match(app, /bonusLink\.textContent = sellerRole \? 'Моя премия' : \(isStoreMode\(\) \? 'Премия магазина' : 'Премии'\)/);
  assert.match(app, /if \(isStoreMode\(\)\) await loadStoreBonus\(\)/);
});

test('store mode keeps monthly plan editing but hides Miska KPI settings', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(html, /id="plan-form"/);
  assert.match(html, /data-miska-settings/);
  assert.match(app, /settingsLink\.textContent = isStoreMode\(\) \? 'План' : 'Настройки'/);
  assert.match(app, /if \(isStoreMode\(\)\) await loadDashboard\(\);\s*else await loadSettings\(\)/);
});

test('store daily input hides seller and shift key while preserving Miska form', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(html, /id="shift-employee-field"/);
  assert.match(html, /id="shift-key-field"/);
  assert.match(app, /element\('shift-employee-field'\)\.hidden = !miskaMode/);
  assert.match(app, /employeeCode === `\$\{store\?\.code\}-store-input`/);
});

test('owner tasks page exposes automatic Today training control', () => {
  assert.match(html, /data-task-tab="today"/);
  assert.match(html, /id="owner-today-table"/);
  assert.match(html, /id="owner-today-working"/);
  assert.match(html, /id="owner-today-assigned"/);
  assert.match(html, /id="owner-today-attention"/);
  assert.match(javascript, /function renderOwnerToday\(\)/);
  assert.match(javascript, /item\.carryover\?\.knowledge/);
  assert.match(javascript, /item\.repeatDue\?\.length/);
});

test('owner Today view shows measured KPI training effect', () => {
  assert.match(html, /<th>Эффект KPI<\/th>/);
  assert.match(javascript, /function renderSalesImpactCell\(item\)/);
  assert.match(javascript, /Сменить упражнение/);
  assert.match(javascript, /После упражнения:/);
  assert.match(javascript, /item\.salesImpact\?\.status === 'NO_IMPROVEMENT'/);
});

test('owner Today view exposes exceptions, 7/30 summary and exercise ranking', () => {
  assert.match(html, /id="owner-exception-list"/);
  assert.match(html, /id="owner-summary-7-main"/);
  assert.match(html, /id="owner-summary-30-main"/);
  assert.match(html, /id="owner-ranking-table"/);
  assert.match(javascript, /function renderOwnerExceptions\(items\)/);
  assert.match(javascript, /function renderOwnerPeriodSummaries\(items\)/);
  assert.match(javascript, /function renderExerciseRanking\(\)/);
  assert.match(javascript, /item\.salesEscalation/);
});

test('learning cards show real product examples, consultation scenarios and official sources', () => {
  assert.match(javascript, /На товарах «Миски»/);
  assert.match(javascript, /Сценарий консультации/);
  assert.match(javascript, /Официальные источники/);
  assert.match(javascript, /source\.checkedAt/);
  assert.match(javascript, /noopener noreferrer/);
});

test('learning cards visibly use MinMax as current assortment source', () => {
  assert.match(javascript, /Актуально по Min\/Max «Миски»/);
  assert.match(javascript, /Источник ассортимента: Min\/Max/);
  assert.match(javascript, /позиции по этой теме не найдены/);
  assert.match(javascript, /state\.trainingMinMax/);
});
