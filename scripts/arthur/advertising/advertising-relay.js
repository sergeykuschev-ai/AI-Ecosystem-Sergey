'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');

const PORT = Number(process.env.PORT || 8790);
const SECRET_FILE = process.env.ADVERTISING_SECRET_FILE || '/run/secrets/arthur-advertising-lead-secret';
const ARTHUR_NOTIFY_URL = process.env.ARTHUR_NOTIFY_URL || 'http://telegram-gateway:8788/notify';
const upstreamAddress = new URL(ARTHUR_NOTIFY_URL);
if (!['http:', 'https:'].includes(upstreamAddress.protocol) || upstreamAddress.username || upstreamAddress.password) {
  throw new Error('INVALID_ADVERTISING_NOTIFY_URL');
}
upstreamAddress.pathname = '/internal/amurskmarket/advertising-lead';
upstreamAddress.search = '';

const secret = fs.readFileSync(SECRET_FILE, 'utf8').trim();

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function text(value, max) {
  return typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;
}

function signatureMatches(raw, signature) {
  if (!secret || typeof signature !== 'string' || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest();
  const received = Buffer.from(signature, 'hex');
  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function parsePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.type !== 'advertising_lead') return null;
  if (!/^[0-9a-f-]{36}$/i.test(String(value.eventId || ''))) return null;
  const lead = value.lead;
  if (!lead || typeof lead !== 'object' || Array.isArray(lead)) return null;
  if (!/^[0-9a-f-]{36}$/i.test(String(lead.id || ''))) return null;

  const company = text(lead.company, 160);
  const contactName = text(lead.contactName, 120);
  const phone = text(lead.phone, 40);
  const email = text(lead.email, 254);
  const tariffLabel = text(lead.tariffLabel, 180);
  const message = typeof lead.message === 'string' && lead.message.length <= 1200 ? lead.message.trim() : '';
  if (!company || !contactName || !phone || !email || !tariffLabel) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;

  return { id: lead.id, company, contactName, phone, email, tariffLabel, message };
}

function render(lead) {
  return [
    '<b>Артур · новая заявка на аудиорекламу</b>',
    '',
    'Компания: <b>' + escapeHtml(lead.company) + '</b>',
    'Контакт: ' + escapeHtml(lead.contactName),
    'Телефон: ' + escapeHtml(lead.phone),
    'Email: ' + escapeHtml(lead.email),
    'Тариф: ' + escapeHtml(lead.tariffLabel),
    ...(lead.message ? ['', 'Комментарий: ' + escapeHtml(lead.message)] : []),
    '',
    'Заявка: ' + escapeHtml(lead.id.slice(0, 8).toUpperCase()),
  ].join('\n');
}

function respond(res, status, payload) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    respond(res, 200, { ok: true });
    return;
  }
  if (req.method !== 'POST' || req.url !== '/internal/amurskmarket/advertising-lead') {
    respond(res, 404, { error: 'not_found' });
    return;
  }

  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => {
    raw += chunk;
    if (raw.length > 24 * 1024) req.destroy();
  });
  req.on('end', async () => {
    if (!signatureMatches(raw, req.headers['x-amurskmarket-signature'])) {
      respond(res, 401, { error: 'invalid_signature' });
      return;
    }

    let lead = null;
    try { lead = parsePayload(JSON.parse(raw)); } catch {}
    if (!lead) {
      respond(res, 400, { error: 'invalid_payload' });
      return;
    }

    try {
      const upstream = await fetch(upstreamAddress, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-amurskmarket-signature': req.headers['x-amurskmarket-signature'],
        },
        body: raw,
        signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) {
        respond(res, 502, { error: 'arthur_delivery_failed', status: upstream.status });
        return;
      }
      respond(res, 202, { ok: true });
    } catch {
      respond(res, 502, { error: 'arthur_unreachable' });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(JSON.stringify({ event: 'arthur_advertising_relay_started', port: PORT }));
});
