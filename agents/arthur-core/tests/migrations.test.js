'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '../../../data/arthur/migrations/001_core_profile_memory_audit.up.sql'
);
const rollbackPath = path.join(
  __dirname,
  '../../../data/arthur/migrations/001_core_profile_memory_audit.down.sql'
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const rollback = fs.readFileSync(rollbackPath, 'utf8');

test('initial migration creates profile, memory and append-only audit tables', () => {
  assert.match(sql, /CREATE TABLE arthur_profiles/);
  assert.match(sql, /CREATE TABLE arthur_memory/);
  assert.match(sql, /CREATE TABLE arthur_audit_events/);
  assert.match(sql, /arthur_memory_one_active_key/);
  assert.match(sql, /arthur_audit_no_update/);
  assert.match(sql, /arthur_audit_no_delete/);
});

test('migration contains required domain and confidence constraints', () => {
  assert.match(sql, /'personal'.*'health'.*'travel'.*'content'.*'business'/s);
  assert.match(sql, /confidence >= 0 AND confidence <= 1/);
  assert.match(sql, /value_json jsonb NOT NULL/);
});

test('rollback removes objects in dependency-safe order', () => {
  const audit = rollback.indexOf('DROP TABLE IF EXISTS arthur_audit_events');
  const memory = rollback.indexOf('DROP TABLE IF EXISTS arthur_memory');
  const profiles = rollback.indexOf('DROP TABLE IF EXISTS arthur_profiles');
  assert.ok(audit >= 0 && memory > audit && profiles > memory);
});
