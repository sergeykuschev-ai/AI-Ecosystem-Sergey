const fs = require('node:fs');
const path = require('node:path');

const { HttpError } = require('./responses');

const DEFAULT_PUBLIC_ROOT = path.resolve(__dirname, '../public');
const DEFAULT_CSV_EXPORTER_PATH = path.resolve(
  __dirname,
  '../../../shared/reporting/csv_exporter.js'
);
const DEFAULT_XLSX_EXPORTER_PATH = path.resolve(
  __dirname,
  '../../../shared/reporting/xlsx_exporter.js'
);
const DEFAULT_FFLATE_BROWSER_PATH = path.resolve(
  __dirname,
  '../../../node_modules/fflate/umd/index.js'
);
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
  '/csv_exporter.js': Object.freeze({
    name: null,
    source: 'csvExporter',
    contentType: 'text/javascript; charset=utf-8',
  }),
  '/xlsx_exporter.js': Object.freeze({
    name: null,
    source: 'xlsxExporter',
    contentType: 'text/javascript; charset=utf-8',
  }),
  '/fflate.js': Object.freeze({
    name: null,
    source: 'fflate',
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
  const csvExporterPath = path.resolve(
    options.csvExporterPath || DEFAULT_CSV_EXPORTER_PATH
  );
  const xlsxExporterPath = path.resolve(
    options.xlsxExporterPath || DEFAULT_XLSX_EXPORTER_PATH
  );
  const fflateBrowserPath = path.resolve(
    options.fflateBrowserPath || DEFAULT_FFLATE_BROWSER_PATH
  );
  const externalPaths = Object.freeze({
    csvExporter: csvExporterPath,
    xlsxExporter: xlsxExporterPath,
    fflate: fflateBrowserPath,
  });
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

    const filePath = entry.name
      ? path.join(publicRoot, entry.name)
      : externalPaths[entry.source];
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
  DEFAULT_CSV_EXPORTER_PATH,
  DEFAULT_FFLATE_BROWSER_PATH,
  DEFAULT_PUBLIC_ROOT,
  DEFAULT_XLSX_EXPORTER_PATH,
  STATIC_FILES,
  createStaticHandler,
  unsafeStaticPath,
};
