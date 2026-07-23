const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Busboy = require('busboy');

const {
  DEFAULT_UPLOAD_ROOT,
  DEFAULT_UPLOAD_TIMEOUT_MS,
  MAX_REQUEST_BODY_BYTES,
  MAX_UPLOAD_FILE_BYTES,
  isValidRunId,
} = require('../config');
const { safeOriginalName } = require('../dto/run_status_mapper');
const { HttpError } = require('./responses');

const MIME_BY_EXTENSION = Object.freeze({
  '.xlsx': new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
  ]),
  '.xls': new Set([
    'application/vnd.ms-excel',
    'application/octet-stream',
  ]),
});
const XLS_SIGNATURE = Buffer.from([
  0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1,
]);

function validateReportDate(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(
      'INVALID_REPORT_DATE',
      'report_date должен иметь формат YYYY-MM-DD.'
    );
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(
      'INVALID_REPORT_DATE',
      'report_date содержит недопустимую календарную дату.'
    );
  }
  return value;
}

function validateFileMetadata(filename, mimeType) {
  const displayName = safeOriginalName(filename);
  const extension = path.extname(displayName || '').toLowerCase();
  if (!MIME_BY_EXTENSION[extension] ||
      !MIME_BY_EXTENSION[extension].has(String(mimeType).toLowerCase())) {
    throw new HttpError(
      'UNSUPPORTED_FILE_TYPE',
      'Разрешены только Excel-файлы .xlsx и .xls с корректным MIME-типом.'
    );
  }
  return { displayName, extension };
}

function hasExcelSignature(buffer, extension) {
  if (extension === '.xlsx') {
    return buffer.length >= 4 &&
      buffer[0] === 0x50 &&
      buffer[1] === 0x4b &&
      buffer[2] === 0x03 &&
      buffer[3] === 0x04;
  }
  return buffer.length >= XLS_SIGNATURE.length &&
    buffer.subarray(0, XLS_SIGNATURE.length).equals(XLS_SIGNATURE);
}

function cleanupUploadDirectory(uploadRoot, requestId, fsModule = fs) {
  if (!isValidRunId(requestId)) return;
  fsModule.rmSync(path.join(path.resolve(uploadRoot), requestId), {
    recursive: true,
    force: true,
  });
}

function persistUploadedFile({
  file,
  temporaryPath,
  finalPath,
  extension,
  fsModule,
  outputs,
}) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const signatureChunks = [];
    let signatureLength = 0;
    let sizeBytes = 0;
    let limitReached = false;
    const output = fsModule.createWriteStream(temporaryPath, {
      flags: 'wx',
      mode: 0o600,
    });
    outputs.push(output);

    file.on('limit', () => {
      limitReached = true;
    });
    file.on('data', chunk => {
      sizeBytes += chunk.length;
      hash.update(chunk);
      if (signatureLength < XLS_SIGNATURE.length) {
        const needed = XLS_SIGNATURE.length - signatureLength;
        const part = chunk.subarray(0, needed);
        signatureChunks.push(part);
        signatureLength += part.length;
      }
    });
    file.once('error', error => output.destroy(error));
    output.once('error', reject);
    output.once('finish', () => {
      try {
        if (limitReached || file.truncated) {
          throw new HttpError(
            'UPLOAD_TOO_LARGE',
            'Размер Excel-файла превышает 20 MiB.'
          );
        }
        const signature = Buffer.concat(signatureChunks);
        if (!hasExcelSignature(signature, extension)) {
          throw new HttpError(
            'UNSUPPORTED_FILE_TYPE',
            'Содержимое файла не соответствует формату Excel.'
          );
        }
        const descriptor = fsModule.openSync(temporaryPath, 'r');
        try {
          fsModule.fsyncSync(descriptor);
        } finally {
          fsModule.closeSync(descriptor);
        }
        fsModule.renameSync(temporaryPath, finalPath);
        resolve({
          sizeBytes,
          sha256: hash.digest('hex'),
        });
      } catch (error) {
        reject(error);
      }
    });
    file.pipe(output);
  });
}

function parseExcelUpload(request, options = {}) {
  const uploadRoot = path.resolve(options.uploadRoot || DEFAULT_UPLOAD_ROOT);
  const requestId = options.requestId;
  const fsModule = options.fsModule || fs;
  const maxFileBytes = options.maxFileBytes || MAX_UPLOAD_FILE_BYTES;
  const maxRequestBytes = options.maxRequestBytes || MAX_REQUEST_BODY_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_UPLOAD_TIMEOUT_MS;

  if (!isValidRunId(requestId)) {
    return Promise.reject(new HttpError(
      'INVALID_MULTIPART',
      'Upload request не может быть обработан.'
    ));
  }

  const contentLength = Number(request.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
    return Promise.reject(new HttpError(
      'UPLOAD_TOO_LARGE',
      'Размер multipart-запроса превышает 21 MiB.'
    ));
  }

  const uploadDirectory = path.join(uploadRoot, requestId);
  const temporaryPath = path.join(uploadDirectory, 'upload.tmp');
  fsModule.mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });

  let parser;
  try {
    parser = Busboy({
      headers: request.headers,
      limits: {
        fileSize: maxFileBytes,
        files: 2,
        fields: 2,
        fieldSize: 64,
        parts: 4,
      },
      preservePath: false,
    });
  } catch (error) {
    cleanupUploadDirectory(uploadRoot, requestId, fsModule);
    return Promise.reject(new HttpError(
      'INVALID_MULTIPART',
      'Некорректный multipart/form-data запрос.',
      { cause: error }
    ));
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let fileCount = 0;
    let fileMetadata = null;
    let reportDate = null;
    let reportDateSeen = false;
    let deferredError = null;
    let requestBytes = 0;
    const writes = [];
    const outputs = [];

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      request.off('aborted', onAborted);
      request.off('data', onRequestData);
      if (error) {
        request.unpipe(parser);
        outputs.forEach(output => output.destroy());
        if (!parser.destroyed) parser.destroy();
        if (!request.destroyed) request.resume();
        cleanupUploadDirectory(uploadRoot, requestId, fsModule);
        reject(error);
      } else {
        resolve(value);
      }
    };
    const onAborted = () => finish(new HttpError(
      'INVALID_MULTIPART',
      'Загрузка файла была прервана.'
    ));
    const onRequestData = chunk => {
      requestBytes += chunk.length;
      if (requestBytes > maxRequestBytes && !deferredError) {
        deferredError = new HttpError(
          'UPLOAD_TOO_LARGE',
          'Размер multipart-запроса превышает 21 MiB.'
        );
        finish(deferredError);
      }
    };
    const timeout = setTimeout(() => {
      finish(new HttpError(
        'INVALID_MULTIPART',
        'Превышено время ожидания загрузки.'
      ));
    }, timeoutMs);
    timeout.unref();

    request.once('aborted', onAborted);
    request.on('data', onRequestData);
    parser.on('file', (fieldName, file, info) => {
      fileCount += 1;
      if (fileCount > 1) {
        deferredError ||= new HttpError(
          'MULTIPLE_FILES',
          'Допускается загрузка только одного файла.'
        );
        file.resume();
        return;
      }
      if (fieldName !== 'file') {
        deferredError ||= new HttpError(
          'FILE_REQUIRED',
          'Excel-файл должен быть передан в поле file.'
        );
        file.resume();
        return;
      }
      try {
        const validated = validateFileMetadata(
          info.filename,
          info.mimeType
        );
        const finalPath = path.join(
          uploadDirectory,
          `source${validated.extension}`
        );
        fileMetadata = {
          originalName: validated.displayName,
          extension: validated.extension,
          inputPath: finalPath,
        };
        const write = persistUploadedFile({
          file,
          temporaryPath,
          finalPath,
          extension: validated.extension,
          fsModule,
          outputs,
        }).then(metadata => {
          Object.assign(fileMetadata, metadata);
        });
        write.catch(() => {});
        writes.push(write);
      } catch (error) {
        deferredError ||= error;
        file.resume();
      }
    });
    parser.on('field', (fieldName, value) => {
      if (fieldName !== 'report_date' || reportDateSeen) {
        deferredError ||= new HttpError(
          'INVALID_MULTIPART',
          'Multipart содержит неподдерживаемые или повторяющиеся поля.'
        );
        return;
      }
      reportDateSeen = true;
      try {
        reportDate = validateReportDate(value);
      } catch (error) {
        deferredError ||= error;
      }
    });
    parser.once('filesLimit', () => {
      deferredError ||= new HttpError(
        'MULTIPLE_FILES',
        'Допускается загрузка только одного файла.'
      );
    });
    parser.once('partsLimit', () => {
      deferredError ||= new HttpError(
        'INVALID_MULTIPART',
        'Multipart содержит слишком много частей.'
      );
    });
    parser.once('error', error => finish(new HttpError(
      'INVALID_MULTIPART',
      'Некорректный multipart/form-data запрос.',
      { cause: error }
    )));
    parser.once('close', async () => {
      try {
        const results = await Promise.allSettled(writes);
        const writeFailure = results.find(result => result.status === 'rejected');
        if (writeFailure) throw writeFailure.reason;
        if (deferredError) throw deferredError;
        if (fileCount === 0 || !fileMetadata) {
          throw new HttpError(
            'FILE_REQUIRED',
            'Excel-файл обязателен.'
          );
        }
        finish(null, {
          ...fileMetadata,
          reportDate,
          cleanup: () => cleanupUploadDirectory(
            uploadRoot,
            requestId,
            fsModule
          ),
        });
      } catch (error) {
        finish(error);
      }
    });
    request.pipe(parser);
  });
}

module.exports = {
  MIME_BY_EXTENSION,
  XLS_SIGNATURE,
  cleanupUploadDirectory,
  hasExcelSignature,
  parseExcelUpload,
  validateFileMetadata,
  validateReportDate,
};
