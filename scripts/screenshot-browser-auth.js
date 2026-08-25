'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const puppeteer = require('puppeteer-core');

const { createBusinessKpiWebServer } = require('../apps/business-kpi-web/server');
const { loadConfig } = require('../apps/business-kpi-web/config');
const { AuthService } = require('../apps/business-kpi-web/application/auth_service');
const { DEV_EMPLOYEES, DEV_STORE } = require('../apps/business-kpi-web/storage/in_memory_business_kpi_store');

const OUTPUT_DIR = path.join(__dirname, '../tmp/browser-auth-screenshots');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

const OWNER_PASSWORD = process.env.BROWSER_AUTH_OWNER_PASSWORD || '';
const PRODUCTION_URL = process.env.BROWSER_AUTH_PRODUCTION_URL || 'http://100.78.67.88:13220';

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

async function captureProductionOwner() {
  if (!OWNER_PASSWORD) { console.log('SKIP production owner screenshots'); return; }
  await withBrowser(async browser => {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    await page.goto(`${PRODUCTION_URL}/login.html`, { waitUntil: 'domcontentloaded' });
    await sleep(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '01-login-page.png') });

    await page.type('#login-external-id', 'owner.admin');
    await page.type('#login-password', OWNER_PASSWORD);
    await page.click('#login-submit');
    await page.waitForFunction(() => document.querySelector('.metric-card') !== null, { timeout: 10000 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '02-owner-dashboard.png') });
    await screenshotElement(page, '.sidebar', path.join(OUTPUT_DIR, '03-owner-sidebar.png'));

    await page.click('#logout-button');
    await page.waitForFunction(() => document.querySelector('#login-form') !== null, { timeout: 10000 });
    await sleep(500);
    await page.screenshot({ path: path.join(OUTPUT_DIR, '08-after-logout.png') });
    await context.close();
  });
}

async function captureLocalSeller() {
  const config = loadConfig({ BUSINESS_KPI_DEV_MODE: 'true', BUSINESS_KPI_SEED_REFERENCE_DATA: 'true' });
  const server = createBusinessKpiWebServer({ config });
  const authService = new AuthService({ store: server.businessKpiStore });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const employee = server.businessKpiStore.employees.find(e => e.id === DEV_EMPLOYEES[0].id);
  if (employee) employee.userId = 'local-seller-1';
  await authService.createUser({
    id: 'local-seller-1', externalId: 'local.seller', displayName: 'Local Seller',
    role: 'SELLER', storeId: DEV_STORE.id, password: 'local-seller-password',
  });

  try {
    await withBrowser(async browser => {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      await page.setExtraHTTPHeaders({
        'x-business-kpi-actor-id': 'local-seller-1',
        'x-business-kpi-role': 'SELLER',
      });

      await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('.metric-card') !== null, { timeout: 10000 });
      await sleep(500);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '04-seller-dashboard.png') });
      await screenshotElement(page, '.sidebar', path.join(OUTPUT_DIR, '05-seller-sidebar.png'));

      await page.goto(`${baseUrl}/#sellers`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#sellers-table') !== null, { timeout: 10000 });
      await sleep(500);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '06-seller-sellers-page.png') });

      await page.goto(`${baseUrl}/#bonuses`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => document.querySelector('#bonuses-table') !== null, { timeout: 10000 });
      await sleep(500);
      await page.screenshot({ path: path.join(OUTPUT_DIR, '07-seller-bonuses.png') });
      await context.close();
    });
  } finally {
    server.close();
    await once(server, 'close');
  }
}

(async () => {
  await captureProductionOwner();
  await captureLocalSeller();
  console.log('Screenshots saved to', OUTPUT_DIR);
})().catch(error => { console.error(error); process.exitCode = 1; });
