'use strict';

// Transport fixture: ; ' " \\ JSON {"ok":true} URL http://127.0.0.1/ Кириллица.

const fs = require('node:fs');

if (process.env.MINMAX_PROBE_PRINT_SELF_BYTES === '1') {
  process.stdout.write(fs.readFileSync(__filename).toString('base64'));
} else {
  const base = String(process.env.MINMAX_PROBE_BASE_URL || '').replace(/\/$/, '');
  const key = process.env.MINMAX_VERIFY_API_KEY;
  const modes = [
    ['none', {}],
    ['bearer', { authorization: `Bearer ${key}` }],
    ['x-api-key', { 'x-api-key': key }],
  ];
  Promise.all(modes.map(async ([mode, headers]) => {
    const response = await fetch(`${base}/api/v1/health`, { headers });
    return {
      mode,
      status: response.status,
      contentType: response.headers.get('content-type') || '',
      body: await response.text(),
    };
  })).then(value => {
    process.stdout.write(JSON.stringify(value));
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
