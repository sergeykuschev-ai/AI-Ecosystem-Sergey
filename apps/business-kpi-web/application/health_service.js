'use strict';

class HealthService {
  constructor({ databaseSchema, devMode, storageProvider, checkStorage }) {
    this.databaseSchema = databaseSchema;
    this.devMode = devMode;
    this.storageProvider = storageProvider;
    this.checkStorage = checkStorage;
  }

  async getHealth() {
    let checked = false;
    let healthy = null;
    if (this.storageProvider === 'postgresql') {
      checked = true;
      try {
        healthy = await this.checkStorage();
      } catch {
        healthy = false;
      }
    }
    return {
      status: healthy === false ? 'degraded' : 'ok',
      service: 'business-kpi-web',
      apiVersion: 'v1',
      mode: this.devMode ? 'LOCAL_DEV' : 'AUTH_REQUIRED',
      storage: {
        provider: this.storageProvider,
        schema: this.databaseSchema,
        configured: this.storageProvider === 'postgresql',
        checked,
        healthy,
      },
    };
  }
}

module.exports = {
  HealthService,
};
