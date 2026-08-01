'use strict';

const fs = require('node:fs');

const {
  DEFAULT_UPLOAD_IDEMPOTENCY_PATH,
  isValidIdempotencyKey,
} = require('../config');
const { atomicWriteFile } = require('./file_artifact_store');

const STORE_VERSION = 1;

// Durable upload idempotency registry (source of truth for the Min/Max
// mail intake). It survives n8n workflow reimports and reinstalls, is
// inspectable through the API and as a plain JSON file, and every write
// is atomic (tmp + fsync + rename) and serialized through an in-process
// queue so concurrent requests cannot interleave read-modify-write.
const UPLOAD_IDEMPOTENCY_STATES = Object.freeze([
  'received',
  'uploading',
  'run_created',
  'processing',
  'completed',
  'failed',
  'uncertain',
  'ignored',
  'rejected',
]);

const RECORD_FIELDS = Object.freeze([
  'idempotencyKey',
  'mailbox',
  'messageUid',
  'attachmentName',
  'attachmentSize',
  'sha256',
  'state',
  'runId',
  'errorCode',
  'createdAt',
  'updatedAt',
  'notificationSentAt',
]);

function storageError(message, cause) {
  return Object.assign(new Error(message), {
    code: 'UPLOAD_IDEMPOTENCY_STORAGE_ERROR',
    cause,
  });
}

function sanitizeText(value, maxLength = 512) {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (text.includes('\0')) {
    throw storageError('Idempotency record содержит недопустимое значение.');
  }
  return text.slice(0, maxLength);
}

function cloneRecord(record) {
  return record ? { ...record } : null;
}

class UploadIdempotencyStore {
  constructor(options = {}) {
    this.filePath = options.filePath || DEFAULT_UPLOAD_IDEMPOTENCY_PATH;
    this.fsModule = options.fsModule || fs;
    this.atomicWriteOptions = options.atomicWriteOptions || {};
    this.now = options.now || (() => new Date().toISOString());
    this.queue = Promise.resolve();
    this.records = this.loadRecords();
  }

  loadRecords() {
    if (!this.fsModule.existsSync(this.filePath)) return {};
    let parsed;
    try {
      parsed = JSON.parse(
        this.fsModule.readFileSync(this.filePath, 'utf8')
      );
    } catch (error) {
      throw storageError(
        'Upload idempotency registry повреждён и не может быть прочитан.',
        error
      );
    }
    if (
      !parsed ||
      parsed.version !== STORE_VERSION ||
      !parsed.records ||
      typeof parsed.records !== 'object' ||
      Array.isArray(parsed.records)
    ) {
      throw storageError(
        'Upload idempotency registry имеет неподдерживаемый формат.'
      );
    }
    const records = {};
    for (const [key, record] of Object.entries(parsed.records)) {
      if (!isValidIdempotencyKey(key)) continue;
      records[key] = this.normalizeRecord(record);
    }
    return records;
  }

  normalizeRecord(record) {
    const normalized = {};
    for (const field of RECORD_FIELDS) {
      normalized[field] = record?.[field] ?? null;
    }
    if (!UPLOAD_IDEMPOTENCY_STATES.includes(normalized.state)) {
      normalized.state = 'uncertain';
    }
    return normalized;
  }

  persist() {
    const payload = JSON.stringify(
      { version: STORE_VERSION, records: this.records },
      null,
      2
    );
    try {
      atomicWriteFile(this.filePath, payload, {
        ...this.atomicWriteOptions,
        fsModule: this.fsModule,
      });
    } catch (error) {
      throw storageError(
        'Не удалось сохранить upload idempotency registry.',
        error
      );
    }
  }

  enqueue(operation) {
    const run = this.queue.then(operation);
    // Keep the chain alive even if one operation fails.
    this.queue = run.catch(() => {});
    return run;
  }

  get(key) {
    if (!isValidIdempotencyKey(key)) return null;
    return cloneRecord(this.records[key]);
  }

  /**
   * Atomically returns the existing record for the key or creates a new
   * one in state `received`. A record that was persisted with a different
   * sha256 yields `conflict: true` — the caller must never create a
   * second run for that key.
   */
  registerReceived(input) {
    return this.enqueue(() => {
      const key = input.idempotencyKey;
      if (!isValidIdempotencyKey(key)) {
        throw storageError('Idempotency key имеет недопустимое значение.');
      }
      const existing = this.records[key];
      if (existing) {
        const conflict = Boolean(
          existing.sha256 &&
          input.sha256 &&
          existing.sha256 !== input.sha256
        );
        return {
          record: cloneRecord(existing),
          created: false,
          conflict,
        };
      }
      const timestamp = this.now();
      const record = this.normalizeRecord({
        idempotencyKey: key,
        mailbox: sanitizeText(input.mailbox),
        messageUid: sanitizeText(input.messageUid, 128),
        attachmentName: sanitizeText(input.attachmentName, 256),
        attachmentSize:
          Number.isFinite(input.attachmentSize) && input.attachmentSize >= 0
            ? Math.floor(input.attachmentSize)
            : null,
        sha256: sanitizeText(input.sha256, 64),
        state: input.state && UPLOAD_IDEMPOTENCY_STATES.includes(input.state)
          ? input.state
          : 'received',
        runId: null,
        errorCode: sanitizeText(input.errorCode, 128),
        createdAt: timestamp,
        updatedAt: timestamp,
        notificationSentAt: null,
      });
      this.records[key] = record;
      this.persist();
      return { record: cloneRecord(record), created: true, conflict: false };
    });
  }

  update(key, patch = {}) {
    return this.enqueue(() => {
      const existing = this.records[key];
      if (!existing) return null;
      if (patch.state !== undefined) {
        if (!UPLOAD_IDEMPOTENCY_STATES.includes(patch.state)) {
          throw storageError(
            `Idempotency state ${patch.state} не поддерживается.`
          );
        }
        existing.state = patch.state;
      }
      for (const field of [
        'mailbox',
        'messageUid',
        'attachmentName',
        'errorCode',
      ]) {
        if (patch[field] !== undefined) {
          existing[field] = sanitizeText(
            patch[field],
            field === 'attachmentName' ? 256 : field === 'messageUid' ? 128 : 128
          );
        }
      }
      if (patch.attachmentSize !== undefined) {
        existing.attachmentSize =
          Number.isFinite(patch.attachmentSize) && patch.attachmentSize >= 0
            ? Math.floor(patch.attachmentSize)
            : null;
      }
      if (patch.sha256 !== undefined) {
        existing.sha256 = sanitizeText(patch.sha256, 64);
      }
      if (patch.runId !== undefined) {
        existing.runId = patch.runId === null
          ? null
          : sanitizeText(patch.runId, 64);
      }
      if (patch.notificationSentAt !== undefined) {
        existing.notificationSentAt = patch.notificationSentAt === null
          ? null
          : sanitizeText(patch.notificationSentAt, 64);
      }
      existing.updatedAt = this.now();
      this.persist();
      return cloneRecord(existing);
    });
  }
}

module.exports = {
  RECORD_FIELDS,
  STORE_VERSION,
  UPLOAD_IDEMPOTENCY_STATES,
  UploadIdempotencyStore,
};
