'use strict';

class ApplicationError extends Error {
  constructor(code, message, statusCode = 400, options = {}) {
    super(message, options);
    this.name = 'ApplicationError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = options.details || null;
  }
}

module.exports = { ApplicationError };
