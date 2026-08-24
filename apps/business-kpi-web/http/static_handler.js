'use strict';

const fs = require('node:fs');
const path = require('node:path');

const STATIC_FILES = Object.freeze({
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/formatters.js': ['formatters.js', 'text/javascript; charset=utf-8'],
  '/assets/miska-logo.jpg': ['assets/miska-logo.jpg', 'image/jpeg'],
});

function createStaticHandler(publicRoot) {
  return function serveStatic(pathname, response) {
    const entry = STATIC_FILES[pathname];
    if (!entry) return false;

    const filePath = path.join(publicRoot, entry[0]);
    const content = fs.readFileSync(filePath);
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': content.length,
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Content-Type': entry[1],
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
    });
    response.end(content);
    return true;
  };
}

module.exports = {
  STATIC_FILES,
  createStaticHandler,
};
