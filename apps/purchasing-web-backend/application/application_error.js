class PurchasingWebApplicationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'PurchasingWebApplicationError';
    this.code = code;
  }

  toPublicData() {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

module.exports = { PurchasingWebApplicationError };
