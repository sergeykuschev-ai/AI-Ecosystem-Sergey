'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { AuthService, verifyPassword } = require('../application/auth_service');
const {
  bootstrapStoreUsers,
} = require('../application/bootstrap_store_users');
const {
  InMemoryBusinessKpiStore,
} = require('../storage/in_memory_business_kpi_store');

const SECRET_A = 'A1b2C3d4E5f6!';
const SECRET_B = 'Z9y8X7w6V5u4!';

test('bootstrap creates isolated manager accounts for Amper and Ventil', async () => {
  const store = new InMemoryBusinessKpiStore();
  const authService = new AuthService({ store });
  let sequence = 0;
  const results = await bootstrapStoreUsers({
    store,
    authService,
    uuid: () => `bootstrap-${++sequence}`,
    env: {
      BUSINESS_KPI_AMPER_PASSWORD: SECRET_A,      BUSINESS_KPI_VENTIL_PASSWORD: SECRET_B,
    },
  });
  assert.equal(results.length, 2);
  const amper = await store.getUserByExternalId('amper');
  const ventil = await store.getUserByExternalId('ventil');
  assert.equal(amper.role, 'MANAGER');
  assert.equal(ventil.role, 'MANAGER');
  assert.notEqual(amper.storeId, ventil.storeId);
  assert.equal(await verifyPassword(SECRET_A, amper.passwordHash), true);
  assert.equal(await verifyPassword(SECRET_B, ventil.passwordHash), true);
});

test('bootstrap rotates secret only for matching existing store manager', async () => {
  const store = new InMemoryBusinessKpiStore();
  const authService = new AuthService({ store });
  await bootstrapStoreUsers({
    store,
    authService,
    uuid: () => 'bootstrap-amper',
    env: { BUSINESS_KPI_AMPER_PASSWORD: SECRET_A },
  });
  const rotated = 'N3wS3cretValue!';
  const [result] = await bootstrapStoreUsers({
    store,    authService,
    env: { BUSINESS_KPI_AMPER_PASSWORD: rotated },
  });
  assert.equal(result.action, 'password-updated');
  const amper = await store.getUserByExternalId('amper');
  assert.equal(await verifyPassword(rotated, amper.passwordHash), true);
});
