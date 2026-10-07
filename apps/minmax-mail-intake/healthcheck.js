'use strict';

const http = require('node:http');

const request = http.get('http://127.0.0.1:3220/health', response => {
  let body = '';
  response.setEncoding('utf8');
  response.on('data', chunk => { body += chunk; });
  response.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); } catch { process.exitCode = 1; return; }
    if (
      response.statusCode !== 200 ||
      parsed.service !== 'minmax-direct-mail-intake' ||
      !parsed.build_sha ||
      parsed.build_sha !== process.env.MINMAX_BUILD_SHA
    ) {
      process.exitCode = 1;
    }
  });
});
request.setTimeout(4000, () => request.destroy(new Error('health timeout')));
request.on('error', () => { process.exitCode = 1; });
