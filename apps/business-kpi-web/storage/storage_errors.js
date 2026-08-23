'use strict';

class StorageConflictError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'StorageConflictError';
    this.code = code;
  }
}

module.exports = { StorageConflictError };
