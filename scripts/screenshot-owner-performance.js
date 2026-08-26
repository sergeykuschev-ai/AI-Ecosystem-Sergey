'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const puppeteer = require('puppeteer-core');

const { createBusinessKpiWebServer } = require('../apps/business-kpi-web/server');
const { loadConfig } = require('../apps/business-kpi-web/config');
const { AuthService } = require('../apps/business-kpi-web/application/auth_service');
const { BusinessKpiService } = require('../apps/business-kpi-web/application/business_kpi_service');
const { DEV_EMPLOYEES, DEV_STORE } = require('../apps/business-kpi-web/storage/in_memory_business_kpi_store');

const OUTPUT_DIR = path.join(__dirname, '../tmp/browser-auth-screenshots');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const OWNER_ID = 'local-owner-perf';
const OWNER_EXTERNAL_ID = 'local.owner.perf';

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

function baseShift(employeeId, day, kpiScore) {
  return {
    storeId: DEV_STORE.id,
    employeeId,
    shiftDate: `2026-08-${String(day).padStart(2, '0')}`,
    shiftKey: 'main',
    cash: 0,
    acquiring: 24000,
    qr: 2400,
    receipts: 20,
    itemsSold: 50,
    upsellReceipts: 6,
    treatsRevenue: 0,
    treatsReceipts: 4,
  };
}

async function seedPerformanceData(service) {
  const employeeA = DEV_EMPLOYEES[2].id;
  const employeeB = DEV_EMPLOYEES[3].id;
  for (let day = 1; day <= 10; day += 1) {
    const kpiA = day <= 5 ? 88 + day : 92 + (day - 5);
    await service.createShift(baseShift(employeeA, day, kpiA), { id: OWNER_ID, role: 'OWNER' });
    const kpiB = day <= 5 ? 96 : 90 + (day - 5);
    await service.createShift(baseShift(employeeB, day, kpiB), { id: OWNER_ID, role: 'OWNER' });
  }
}

(async () => {
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
    displayName: 'Local Performance Owner',
    role: 'OWNER',
    storeId: DEV_STORE.id,
    password: 'local-owner-password',
  });

  await seedPerformanceData(businessService);

  try {
    await withBrowser(async browser => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      page.on('console', msg => console.log('PAGE CONSOLE:', msg.text()));
      page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
      await page.setExtraHTTPHeaders({
        'x-business-kpi-actor-id': OWNER_ID,
        'x-business-kpi-role': 'OWNER',
      });

      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#seller-performance-card', { timeout: 10000 });
      await sleep(800);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '11-owner-dashboard-performance.png') });
      await screenshotElement(page, '#seller-performance-card', path.join(OUTPUT_DIR, '12-owner-performance-block.png'));
      await screenshotElement(page, '#management-signals', path.join(OUTPUT_DIR, '13-owner-management-signals.png'));

      await page.setViewport({ width: 1280, height: 900 });
      await page.screenshot({ path: path.join(OUTPUT_DIR, '14-owner-dashboard-1280.png') });

      await page.setViewport({ width: 1440, height: 900 });
      await page.goto(`${baseUrl}/#sellers`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#sellers-table tr', { timeout: 10000 });
      const sellerRows = await page.$$('#sellers-table tr');
      if (sellerRows.length > 0) {
        await sellerRows[0].click();
        await page.waitForSelector('#seller-detail-card:not([hidden])', { timeout: 10000 });
        await sleep(800);
        await page.screenshot({ path: path.join(OUTPUT_DIR, '15-owner-seller-detail.png') });
        await screenshotElement(page, '#seller-detail-card', path.join(OUTPUT_DIR, '16-owner-seller-detail-card.png'));
      }

      await page.setViewport({ width: 390, height: 844 });
      await page.goto(`${baseUrl}/`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('#seller-performance-card', { timeout: 10000 });
      await sleep(800);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '17-owner-dashboard-mobile.png'), fullPage: true });
      await page.evaluate(() => {
        const wrap = document.querySelector('#seller-performance-card .table-wrap');
        if (wrap) wrap.scrollLeft = wrap.scrollWidth;
      });
      await sleep(400);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '17b-owner-dashboard-mobile-table-scrolled.png'), fullPage: true });

      await context.close();
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
  console.log('Owner performance screenshots saved to', OUTPUT_DIR);
})().catch(error => { console.error(error); process.exitCode = 1; });
