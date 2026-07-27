const fs = require('node:fs');
const path = require('node:path');

const { HttpError } = require('./responses');

const DEFAULT_PUBLIC_ROOT = path.resolve(__dirname, '../public');
const STATIC_FILES = Object.freeze({
  '/': Object.freeze({
    name: 'index.html',
    contentType: 'text/html; charset=utf-8',
  }),
  '/styles.css': Object.freeze({
    name: 'styles.css',
    contentType: 'text/css; charset=utf-8',
  }),
  '/app.js': Object.freeze({
    name: 'app.js',
    contentType: 'text/javascript; charset=utf-8',
  }),
});

function unsafeStaticPath(rawPath) {
  let candidate = String(rawPath || '');
  for (let index = 0; index < 2; index += 1) {
    if (
      candidate.includes('\0') ||
      candidate.includes('\\') ||
      candidate.split('/').includes('..')
    ) {
      return true;
    }
    try {
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) break;
      candidate = decoded;
    } catch {
      return true;
    }
  }
  return (
    candidate.includes('\0') ||
    candidate.includes('\\') ||
    candidate.split('/').includes('..') ||
    candidate.startsWith('//')
  );
}

function createStaticHandler(options = {}) {
  const publicRoot = path.resolve(
    options.publicRoot || DEFAULT_PUBLIC_ROOT
  );
  const fsModule = options.fsModule || fs;

  return async function serveStatic(rawPath, response) {
    if (unsafeStaticPath(rawPath)) {
      throw new HttpError(
        'INVALID_STATIC_PATH',
        'Путь к статическому ресурсу недопустим.'
      );
    }

    const entry = STATIC_FILES[rawPath];
    if (!entry) {
      throw new HttpError(
        'ROUTE_NOT_FOUND',
        'Запрошенный ресурс не найден.'
      );
    }

    const filePath = path.join(publicRoot, entry.name);
    let status;
    try {
      status = fsModule.lstatSync(filePath);
      if (status.isSymbolicLink() || !status.isFile()) {
        throw new Error('Static resource is not a regular file.');
      }
    } catch (error) {
      throw new HttpError(
        'ROUTE_NOT_FOUND',
        'Запрошенный ресурс не найден.',
        { cause: error }
      );
    }

    response.writeHead(200, {
      'Cache-Control': 'no-store',
      'Content-Length': status.size,
      'Content-Type': entry.contentType,
      'X-Content-Type-Options': 'nosniff',
    });

    await new Promise((resolve, reject) => {
      const stream = fsModule.createReadStream(filePath);
      stream.once('error', reject);
      response.once('finish', resolve);
      response.once('close', resolve);
      stream.pipe(response);
    });
    return { streamed: true };
  };
}

module.exports = {
  DEFAULT_PUBLIC_ROOT,
  STATIC_FILES,
  createStaticHandler,
  unsafeStaticPath,
};
