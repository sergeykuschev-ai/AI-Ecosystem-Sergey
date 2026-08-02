'use strict';

const fs = require('node:fs');

if (process.env.MINMAX_PROBE_PRINT_SELF_BYTES === '1') {
  process.stdout.write(fs.readFileSync(__filename).toString('base64'));
} else {
  const url = process.env.MINMAX_PROBE_URL;
  const token = process.env.MINMAX_INSPECT_API_KEY;
  fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json', 'x-api-key': token },
  }).then(async response => ({
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body: await response.text(),
  })).then(value => {
    process.stdout.write(JSON.stringify(value));
  }).catch(error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
