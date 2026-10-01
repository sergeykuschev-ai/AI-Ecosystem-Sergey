/* eslint-disable @typescript-eslint/no-require-imports -- Node regression test. */
const { test } = require('node:test')
const assert = require('node:assert/strict')
require('../scripts/register-typescript.cjs')
const { searchIndexingEnabled, publicRobots } = require('../src/seo/indexing.ts')

test('search indexing is fail-closed and requires an explicit true flag', () => {
  assert.equal(searchIndexingEnabled(undefined), false)
  assert.equal(searchIndexingEnabled('false'), false)
  assert.equal(searchIndexingEnabled('TRUE'), false)
  assert.equal(searchIndexingEnabled('true'), true)
  assert.deepEqual(publicRobots(undefined), { index: false, follow: false })
  assert.deepEqual(publicRobots('true'), { index: true, follow: true })
})
