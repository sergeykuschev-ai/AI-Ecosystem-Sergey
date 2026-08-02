'use strict';

const http = require('node:http');
const { printSelfBytes } = require('../container-probe-runner');

if (!printSelfBytes(module)) {
  const request = http.get(
    'http://127.0.0.1:3210/api/v1/health',
    response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => {
        process.stdout.write(JSON.stringify({
          status: response.statusCode,
          contentType: response.headers['content-type'] || '',
          body,
        }));
      });
    }
  );
  request.setTimeout(4000, () => request.destroy(new Error('request timeout')));
  request.on('error', error => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
