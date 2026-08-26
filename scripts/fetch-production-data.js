'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PRODUCTION_URL = process.env.BROWSER_AUTH_PRODUCTION_URL || 'http://100.78.67.88:13220';
const OWNER_EXTERNAL_ID = 'owner.admin';
const OWNER_PASSWORD = process.env.BROWSER_AUTH_OWNER_PASSWORD || '';
const OUTPUT_FILE = path.join(__dirname, '../tmp/production-owner-review-data.json');

function parseCookies(setCookieHeader) {
  if (!setCookieHeader) return [];
  const raw = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
  return raw.map(c => c.split(';')[0]).join('; ');
}

async function api(path, options = {}) {
  const response = await fetch(`${PRODUCTION_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status} ${path}: ${body.slice(0, 200)}`);
  }
  const body = await response.json();
  return { data: body.data, cookies: parseCookies(response.headers.get('set-cookie')) };
}

(async () => {
  if (!OWNER_PASSWORD) {
    console.error('BROWSER_AUTH_OWNER_PASSWORD not set');
    process.exitCode = 1;
    return;
  }

  const login = await api('/api/business-kpi/auth/login', {
    method: 'POST',
    body: JSON.stringify({ externalId: OWNER_EXTERNAL_ID, password: OWNER_PASSWORD }),
  });
  const cookie = login.cookies;
  console.error('Login OK, role=', login.data.user.role);

  const ref = (await api('/api/business-kpi/reference-data', { headers: { Cookie: cookie } })).data;
  const storeId = ref.selectedStoreId;

  const dashboard = (await api(`/api/business-kpi/dashboard?store=${encodeURIComponent(storeId)}&year=2026&month=8`, { headers: { Cookie: cookie } })).data;
  const settings = (await api(`/api/business-kpi/settings?store=${encodeURIComponent(storeId)}&date=2026-08-01`, { headers: { Cookie: cookie } })).data;

  const kap = ref.employees.find(e => e.displayName === 'Капитанова');
  const cher = ref.employees.find(e => e.displayName === 'Чередниченко');

  let kapitanovaShifts = { items: [] };
  if (kap) {
    kapitanovaShifts = (await api(`/api/business-kpi/shifts?store=${encodeURIComponent(storeId)}&year=2026&month=8&employee=${encodeURIComponent(kap.id)}`, { headers: { Cookie: cookie } })).data;
  }

  let cherednichenkoShifts = { items: [] };
  if (cher) {
    cherednichenkoShifts = (await api(`/api/business-kpi/shifts?store=${encodeURIComponent(storeId)}&year=2026&month=8&employee=${encodeURIComponent(cher.id)}`, { headers: { Cookie: cookie } })).data;
  }

  const allAugustShifts = (await api(`/api/business-kpi/shifts?store=${encodeURIComponent(storeId)}&year=2026&month=8`, { headers: { Cookie: cookie } })).data;
  const all2026Shifts = (await api(`/api/business-kpi/shifts?store=${encodeURIComponent(storeId)}&year=2026`, { headers: { Cookie: cookie } })).data;
  const importRuns = (await api(`/api/business-kpi/imports?store=${encodeURIComponent(storeId)}`, { headers: { Cookie: cookie } })).data;

  const payload = {
    referenceData: ref,
    dashboard,
    settings,
    kapitanovaShifts,
    cherednichenkoShifts,
    allAugustShifts,
    all2026Shifts,
    importRuns,
  };

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
  console.error('Saved production data to', OUTPUT_FILE);
  console.log(JSON.stringify({
    ok: true,
    file: OUTPUT_FILE,
    storeId,
    kapitanovaShiftCount: kapitanovaShifts.items?.length ?? kapitanovaShifts.length ?? 0,
    cherednichenkoShiftCount: cherednichenkoShifts.items?.length ?? cherednichenkoShifts.length ?? 0,
  }));
})().catch(error => { console.error(error); process.exitCode = 1; });
