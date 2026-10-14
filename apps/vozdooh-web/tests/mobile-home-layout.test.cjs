const test = require('node:test')
const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { resolve } = require('node:path')

const page = readFileSync(resolve(__dirname, '../app/page.tsx'), 'utf8')
const css = readFileSync(resolve(__dirname, '../app/globals.css'), 'utf8')

test('homepage features one distinct merchandising shelf instead of duplicated product sections', () => {
  assert.equal((page.match(/<MerchSection\s/g) || []).length, 1)
  assert.match(page, /id="popular-fragrances"/)
  assert.doesNotMatch(page, /Четыре позиции из текущего ассортимента/)
  assert.doesNotMatch(page, /Показываем только те пространства/)
})

test('mobile homepage provides horizontal category and room navigation', () => {
  assert.match(css, /\.homeCategoryGrid\{[^}]*grid-auto-flow:column/)
  assert.match(css, /\.roomLinks\.roomVisualGrid\{[^}]*overflow-x:auto/)
  assert.match(css, /#popular-fragrances \.productCardImage\{[^}]*mix-blend-mode:multiply/)
})
