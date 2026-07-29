'use strict';

function getDatabaseConfig(env = process.env) {
  const url = env.ARTHUR_DATABASE_URL;
  if (!url) throw new Error('ARTHUR_DATABASE_URL is required');

  const nodeEnv = env.NODE_ENV || 'development';
  if (nodeEnv === 'test' && !/test/i.test(url)) {
    throw new Error('Test runs require a dedicated database URL containing "test"');
  }

  return Object.freeze({
    url,
    ssl: env.ARTHUR_DATABASE_SSL === 'true',
    applicationName: env.ARTHUR_DATABASE_APP_NAME || 'arthur-core'
  });
}

module.exports = { getDatabaseConfig };
