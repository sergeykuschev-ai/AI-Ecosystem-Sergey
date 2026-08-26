'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const puppeteer = require('puppeteer-core');

const { createBusinessKpiWebServer } = require('../apps/business-kpi-web/server');
const { loadConfig } = require('../apps/business-kpi-web/config');
const { AuthService } = require('../apps/business-kpi-web/application/auth_service');
const { BusinessKpiService } = require('../apps/business-kpi-web/application/business_kpi_service');
const { DEV_STORE } = require('../apps/business-kpi-web/storage/in_memory_business_kpi_store');

const PRODUCTION_DATA_FILE = path.join(__dirname, '../tmp/production-owner-review-data.json');
const OUTPUT_DIR = path.join(__dirname, '../tmp/production-owner-review-screenshots');

const OWNER_ID = 'local-owner-review';
const OWNER_EXTERNAL_ID = 'local.owner.review';
const OWNER_PASSWORD = 'local-owner-review-password';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function withBrowser(fn) {
  const browser = await puppeteer.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try { return await fn(browser); } finally { await browser.close(); }
}

async function screenshotElement(page, selector, file) {
  const el = await page.$(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);
  await el.screenshot({ path: file });
}

function shiftInputFromProduction(shift) {
  return {
    storeId: shift.storeId,
    employeeId: shift.employeeId,
    shiftDate: shift.shiftDate,
    shiftKey: shift.shiftKey || 'main',
    cash: shift.cash,
    acquiring: shift.acquiring,
    qr: shift.qr,
    receipts: shift.receipts,
    itemsSold: shift.itemsSold,
    upsellReceipts: shift.upsellReceipts,
    treatsRevenue: shift.treatsRevenue,
    treatsReceipts: shift.treatsReceipts,
    comment: shift.comment,
  };
}

async function seedProductionShifts(service, productionData, actor) {
  const shifts = productionData.allAugustShifts.items || productionData.allAugustShifts || [];
  console.error(`Importing ${shifts.length} production shifts into local store...`);
  for (const shift of shifts) {
    await service.createShift(shiftInputFromProduction(shift), actor, {
      source: 'excel_import',
      sourceRef: shift.sourceRef || null,
      reason: 'OWNER REVIEW: local preview with read-only production data',
    });
  }
  console.error('Import complete.');
}

function formatNumber(value, digits = 2) {
  if (value === null || value === undefined) return 'н/д';
  return Number(value).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value, digits = 2) {
  if (value === null || value === undefined) return 'н/д';
  return `${(value * 100).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

(async () => {
  if (!fs.existsSync(PRODUCTION_DATA_FILE)) {
    console.error('Production data file not found. Run scripts/fetch-production-data.js first.');
    process.exitCode = 1;
    return;
  }

  const productionData = JSON.parse(fs.readFileSync(PRODUCTION_DATA_FILE, 'utf8'));
  const config = loadConfig({
    BUSINESS_KPI_DEV_MODE: 'true',
    BUSINESS_KPI_SEED_REFERENCE_DATA: 'true',
  });
  const server = createBusinessKpiWebServer({ config });
  const authService = new AuthService({ store: server.businessKpiStore });
  const businessService = new BusinessKpiService({
    store: server.businessKpiStore,
    now: () => new Date('2026-08-25T10:00:00.000Z'),
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  await authService.createUser({
    id: OWNER_ID,
    externalId: OWNER_EXTERNAL_ID,
    displayName: 'Local Owner Review',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: OWNER_PASSWORD,
  });

  const actor = { id: OWNER_ID, role: 'OWNER' };
  await seedProductionShifts(businessService, productionData, actor);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Compute analytics directly via service to include in report.
  const analytics = await businessService.getSellerPerformance(
    { storeId: DEV_STORE.id, year: 2026, month: 8, mode: 'shifts' },
    actor
  );
  const localDashboard = await businessService.getDashboard({ storeId: DEV_STORE.id, year: 2026, month: 8 }, actor);

  const kap = analytics.items.find(i => i.employeeName === 'Капитанова');
  const cher = analytics.items.find(i => i.employeeName === 'Чередниченко');

  try {
    await withBrowser(async browser => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.on('console', msg => console.error('PAGE CONSOLE:', msg.text()));
      page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
      await page.setExtraHTTPHeaders({
        'x-business-kpi-actor-id': OWNER_ID,
        'x-business-kpi-role': 'OWNER',
      });

      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#seller-performance-card', { timeout: 15000 });
      await sleep(1000);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '01-owner-dashboard-full.png') });
      await screenshotElement(page, '#seller-performance-card', path.join(OUTPUT_DIR, '02-owner-performance-block.png'));
      await screenshotElement(page, '#management-signals', path.join(OUTPUT_DIR, '03-owner-management-signals.png'));

      await page.setViewport({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(OUTPUT_DIR, '04-owner-dashboard-1280.png') });

      async function clickSellerRow(page, name) {
        const rows = await page.$$('#sellers-table tr');
        for (const row of rows) {
          const firstCell = await row.$('td');
          if (!firstCell) continue;
          const text = await firstCell.evaluate(el => el.textContent.trim());
          if (text === name) {
            await row.click();
            return true;
          }
        }
        return false;
      }

      // Kapitanova detail
      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/#sellers`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#sellers-table tr', { timeout: 15000 });
      if (await clickSellerRow(page, 'Капитанова')) {
        await page.waitForSelector('#seller-detail-card:not([hidden])', { timeout: 15000 });
        await sleep(800);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '05-kapitanova-detail.png') });
        await screenshotElement(page, '#seller-detail-card', path.join(OUTPUT_DIR, '06-kapitanova-detail-card.png'));
      } else {
        console.error('Kapitanova row not found in sellers table');
      }

      // Cherednichenko detail
      await page.goto(`${baseUrl}/#sellers`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#sellers-table tr', { timeout: 15000 });
      if (await clickSellerRow(page, 'Чередниченко')) {
        await page.waitForSelector('#seller-detail-card:not([hidden])', { timeout: 15000 });
        await sleep(800);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '07-cherednichenko-detail.png') });
        await screenshotElement(page, '#seller-detail-card', path.join(OUTPUT_DIR, '08-cherednichenko-detail-card.png'));
      } else {
        console.error('Cherednichenko row not found in sellers table');
      }

      // Mobile
      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#seller-performance-card', { timeout: 15000 });
      await sleep(800);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '09-owner-dashboard-mobile.png'), fullPage: true });

      await context.close();
    });
  } finally {
    server.close();
    await once(server, 'close');
  }

  function reportSeller(item) {
    if (!item) return null;
    return {
      validShifts: item.shiftCount,
      latest5Count: item.latestWindow?.shiftCount || 0,
      previous5Count: item.previousWindow?.shiftCount || 0,
      currentKpi: formatNumber(item.currentKpi),
      previousKpi: formatNumber(item.previousKpi),
      kpiDelta: formatNumber(item.kpiDelta),
      direction: item.trendDirection,
      trendConfidence: item.trendConfidence,
      trendLabel: item.trendLabel,
      revenuePerShift: formatNumber(item.revenuePerShift),
      receiptsPerShift: formatNumber(item.receiptsPerShift),
      averageCheck: formatNumber(item.averageCheck),
      itemsPerReceipt: formatNumber(item.itemsPerReceipt),
      sellerQrShare: formatPercent(item.sellerQrShare),
      strongestMetric: item.strongestMetric?.label || 'н/д',
      attentionMetric: item.attentionMetric
        ? (item.attentionMetric.key === 'qrShare'
          ? `${item.attentionMetric.label} ${formatNumber(item.attentionMetric.delta * 100)} п.п.`
          : `${item.attentionMetric.label} ${item.attentionMetric.isAbsolute ? formatNumber(item.attentionMetric.delta) : formatNumber(item.attentionMetric.delta * 100)}${item.attentionMetric.isAbsolute ? '' : '%'}`)
        : 'Нет',
      attentionConfidence: item.attentionMetric?.confidence || null,
      dataCompleteness: item.dataCompleteness,
      sparkline: item.sparkline.map(s => s.kpi).join(' → '),
    };
  }

  const report = {
    includedEmployees: analytics.items.map(i => i.employeeName),
    excludedEmployees: analytics.excludedEmployees,
    kapitanova: reportSeller(kap),
    cherednichenko: reportSeller(cher),
    teamSignals: analytics.teamSignals,
    localDashboardReconciliation: {
      revenue: formatNumber(localDashboard.month?.revenue),
      receipts: localDashboard.month?.receipts,
      qr: formatNumber(localDashboard.month?.qr),
      shifts: localDashboard.month?.shiftsCount,
    },
    expectedReconciliation: {
      revenue: '593037,60',
      receipts: 437,
      qr: '166519,80',
      shifts: 22,
    },
    screenshots: OUTPUT_DIR,
  };

  console.log(JSON.stringify(report, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
