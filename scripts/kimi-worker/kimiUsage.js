'use strict';

const http = require('http');
const net = require('net');
const { spawn } = require('child_process');
const config = require('./config');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      server.close((err) => err ? reject(err) : resolve(port));
    });
  });
}

function requestJson(port, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/v1/oauth/usage', timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`usage endpoint HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(body)); }
        catch { reject(new Error('usage endpoint returned invalid JSON')); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('usage endpoint timeout')));
    req.on('error', reject);
  });
}

async function fetchKimiUsage({ command = config.kimi.command, startupTimeoutMs = 8000 } = {}) {
  const port = await freePort();
  const env = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    LANG: process.env.LANG || 'en_US.UTF-8',
  };
  const child = spawn(command, ['web', '--no-open', '--dangerous-bypass-auth', '--port', String(port)], {
    env,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  let spawnError = null;
  child.on('error', (err) => { spawnError = err; });
  const deadline = Date.now() + startupTimeoutMs;
  try {
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      try {
        const payload = await requestJson(port, 700);
        if (payload && payload.code === 0 && payload.data) return payload.data;
        throw new Error('usage endpoint returned unsuccessful payload');
      } catch (err) {
        if (Date.now() + 200 >= deadline) throw err;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }
    throw new Error('Kimi usage server did not become ready');
  } finally {
    if (!child.killed) child.kill('SIGTERM');
    const timer = setTimeout(() => { if (!child.killed) child.kill('SIGKILL'); }, 1500);
    timer.unref();
  }
}

function assessKimiUsage(data, reservePercent = 10) {
  if (!data || data.kind !== 'ok') {
    return { usable: false, reason: 'usage-unavailable', windows: [] };
  }
  const raw = [data.summary, ...(Array.isArray(data.limits) ? data.limits : [])].filter(Boolean);
  const windows = raw.map((item) => {
    const used = Number(item.used);
    const limit = Number(item.limit);
    const remainingPercent = limit > 0 && Number.isFinite(used)
      ? Math.max(0, ((limit - used) / limit) * 100)
      : 0;
    return {
      duration: item.window?.duration,
      unit: item.window?.unit,
      used,
      limit,
      remainingPercent,
      resetAt: item.reset_at || null,
    };
  }).filter((item) => Number.isFinite(item.used) && Number.isFinite(item.limit));

  if (windows.length === 0) return { usable: false, reason: 'usage-unavailable', windows };
  const low = windows.filter((item) => item.remainingPercent <= reservePercent);
  const minRemainingPercent = Math.min(...windows.map((item) => item.remainingPercent));
  return {
    usable: low.length === 0,
    reason: low.length ? 'reserve-protected' : 'quota-available',
    reservePercent,
    minRemainingPercent,
    windows,
  };
}

module.exports = { fetchKimiUsage, assessKimiUsage, requestJson, freePort };
