'use strict';

const crypto = require('node:crypto');
const { ApplicationError } = require('./application_error');

function requiredSecret(value, name) {
  const secret = typeof value === 'string' ? value : '';
  if (secret.length < 12) {
    throw new ApplicationError(
      'BOOTSTRAP_SECRET_INVALID',
      `${name} должен содержать минимум 12 символов.`,
      500
    );
  }
  return secret;
}

function bootstrapDefinitions(env = process.env) {
  return [
    {
      role: 'OWNER',
      code: null,
      externalId: env.BUSINESS_KPI_OWNER_LOGIN || 'kushchev',
      displayName: 'Сергей Кущев',
      password: env.BUSINESS_KPI_OWNER_PASSWORD,
    },    {
      role: 'MANAGER',
      code: 'amper',
      externalId: env.BUSINESS_KPI_AMPER_LOGIN || 'amper',
      displayName: 'Ампер',
      password: env.BUSINESS_KPI_AMPER_PASSWORD,
    },
    {
      role: 'MANAGER',
      code: 'ventil',
      externalId: env.BUSINESS_KPI_VENTIL_LOGIN || 'ventil',
      displayName: 'Вентиль',
      password: env.BUSINESS_KPI_VENTIL_PASSWORD,
    },
  ].filter(item => item.password);
}

async function targetStoreId(store, definition) {
  if (definition.role === 'OWNER') return null;
  const stores = await store.listStores();
  const targetStore = stores.find(item => item.code === definition.code);
  if (!targetStore) {
    throw new ApplicationError(
      'BOOTSTRAP_STORE_NOT_FOUND',
      `Магазин ${definition.code} не найден.`,
      500
    );
  }
  return targetStore.id;
}
async function ensureUser({
  store,
  authService,
  definition,
  uuid = crypto.randomUUID,
}) {
  const password = requiredSecret(
    definition.password,
    `Пароль ${definition.code || definition.externalId}`
  );
  const storeId = await targetStoreId(store, definition);
  const existing = await store.getUserByExternalId(definition.externalId);
  if (existing) {
    if (existing.role !== definition.role || existing.storeId !== storeId) {
      throw new ApplicationError(
        'BOOTSTRAP_USER_CONFLICT',
        `Логин ${definition.externalId} уже принадлежит другой роли или магазину.`,
        500
      );
    }
    await authService.setPassword(existing.id, password);
    return {
      action: 'password-updated',
      externalId: existing.externalId,
      storeCode: definition.code,
      role: definition.role,
    };
  }  await authService.createUser({
    id: uuid(),
    externalId: definition.externalId,
    displayName: definition.displayName,
    role: definition.role,
    storeId,
    password,
  });
  return {
    action: 'created',
    externalId: definition.externalId,
    storeCode: definition.code,
    role: definition.role,
  };
}

async function bootstrapStoreUsers({
  store,
  authService,
  env = process.env,
  uuid,
}) {
  const results = [];
  for (const definition of bootstrapDefinitions(env)) {
    results.push(await ensureUser({ store, authService, definition, uuid }));
  }
  return results;
}
module.exports = {
  bootstrapDefinitions,
  bootstrapStoreUsers,
  ensureUser,
  requiredSecret,
  targetStoreId,
};
