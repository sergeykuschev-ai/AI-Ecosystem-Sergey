const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { after, test } = require('node:test');

const {
  loadOptionalJson,
  loadRequiredJson,
} = require('../../../shared/config/json_config_loader');

const TEMP_DIRECTORY = fs.mkdtempSync(
  path.join(os.tmpdir(), 'json-config-loader-')
);

after(() => {
  fs.rmSync(TEMP_DIRECTORY, { recursive: true, force: true });
});

function writeJson(name, value) {
  const filePath = path.join(TEMP_DIRECTORY, name);
  fs.writeFileSync(filePath, JSON.stringify(value), 'utf8');
  return filePath;
}

function writeText(name, value) {
  const filePath = path.join(TEMP_DIRECTORY, name);
  fs.writeFileSync(filePath, value, 'utf8');
  return filePath;
}

test('loads a valid required JSON configuration', () => {
  const filePath = writeJson('required.json', {
    enabled: true,
    threshold: 5,
  });

  assert.deepEqual(loadRequiredJson(filePath), {
    enabled: true,
    threshold: 5,
  });
});

test('reports a missing required JSON configuration with its cause', () => {
  const filePath = path.join(TEMP_DIRECTORY, 'missing-required.json');

  assert.throws(
    () => loadRequiredJson(filePath, { label: 'тестовая конфигурация' }),
    error => error.code === 'JSON_CONFIG_NOT_FOUND' &&
      error.message.includes('тестовая конфигурация') &&
      error.message.includes('файл не найден') &&
      error.cause?.code === 'ENOENT'
  );
});

test('reports invalid required JSON with its parse cause', () => {
  const filePath = writeText('invalid-required.json', '{ "enabled": ');

  assert.throws(
    () => loadRequiredJson(filePath),
    error => error.code === 'JSON_CONFIG_INVALID_JSON' &&
      error.message.includes('Некорректный JSON') &&
      error.cause instanceof SyntaxError
  );
});

test('loads a valid optional JSON configuration', () => {
  const filePath = writeJson('optional.json', { mode: 'safe' });

  assert.deepEqual(loadOptionalJson(filePath), { mode: 'safe' });
});

test('returns null for a missing optional JSON configuration', () => {
  const filePath = path.join(TEMP_DIRECTORY, 'missing-optional.json');

  assert.equal(loadOptionalJson(filePath), null);
});

test('returns a custom fallback for a missing optional configuration', () => {
  const filePath = path.join(TEMP_DIRECTORY, 'missing-with-fallback.json');
  const fallback = Object.freeze({ enabled: false });

  assert.equal(loadOptionalJson(filePath, { fallback }), fallback);
  assert.deepEqual(fallback, { enabled: false });
});

test('does not hide invalid optional JSON', () => {
  const filePath = writeText('invalid-optional.json', '{ broken');

  assert.throws(
    () => loadOptionalJson(filePath),
    error => error.code === 'JSON_CONFIG_INVALID_JSON' &&
      error.cause instanceof SyntaxError
  );
});

test('does not mutate the source object represented by JSON', () => {
  const source = Object.freeze({
    nested: Object.freeze({ value: 7 }),
    items: Object.freeze(['one', 'two']),
  });
  const filePath = writeJson('immutable-source.json', source);

  const loaded = loadRequiredJson(filePath);

  assert.deepEqual(loaded, source);
  assert.notEqual(loaded, source);
  assert.deepEqual(source, {
    nested: { value: 7 },
    items: ['one', 'two'],
  });
});
