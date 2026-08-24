'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const publicRoot = path.join(__dirname, '../public');
const html = fs.readFileSync(path.join(publicRoot, 'index.html'), 'utf8');
const javascript = fs.readFileSync(path.join(publicRoot, 'app.js'), 'utf8');

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

test('portal branding is MISKA and multi-business ready', () => {
  const css = fs.readFileSync(path.join(publicRoot, 'styles.css'), 'utf8');
  assert.doesNotMatch(html, /Артур Business KPI/);
  assert.doesNotMatch(html, /Ампер|Вентиль|Метиз/);
  assert.match(html, /<title>МИСКА · KPI<\/title>/);
  assert.match(html, /МИСКА/);
  assert.match(javascript, /BUSINESS_CONTEXT/);
  assert.match(javascript, /id:\s*['"]miska['"]/);
  assert.match(css, /--brand-primary:/);
  assert.match(css, /--brand-accent:/);
  assert.match(css, /--brand-primary-dark:/);
});

test('shifts KPI badge is rendered as HTML, not escaped raw markup', () => {
  assert.match(javascript, /function appendKpiCell\(/);
  assert.match(javascript, /appendKpiCell\(row, shift\.metrics\?\.kpiScore, shift\.metrics\?\.kpiLevel, 'numeric'\)/);
  assert.doesNotMatch(javascript, /appendCell\(row, kpiWithBadge\(/);
});

test('official MISKA logo asset is referenced and stored in repository', () => {
  assert.match(html, /assets\/miska-logo\.jpg/);
  assert.ok(fs.existsSync(path.join(publicRoot, 'assets', 'miska-logo.jpg')), 'logo asset exists in public/assets');
});

test('sellers table preserves all business columns', () => {
  for (const label of [
    'Продавец', 'Смены', 'На смену', 'Цель на смену', 'Средний чек', 'Цель ср. чек',
    'Товаров в чеке', 'Цель товаров', 'Доля QR', 'KPI', 'Уровень', 'Бонус',
  ]) {
    assert.match(html, new RegExp(label));
  }
});
