'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PILOT, validatePilot } = require('../../../agents/business-kpi/rules/miska_curriculum_pilot');
const { SELLER_TASK_LIBRARY } = require('../../../agents/business-kpi/rules/seller_task_library');
const { enrichTrainingTask } = require('../../../agents/business-kpi/rules/seller_training_content');

test('academy pilot maps only to existing task codes', () => {
  assert.deepEqual(validatePilot(SELLER_TASK_LIBRARY.map(t => t.code)), []);
  assert.equal(Object.keys(PILOT).length, 3);
});
test('academy pilot questions have valid answers', () => {
  for (const lesson of Object.values(PILOT)) {
    assert.ok(lesson.guide.length > 0);
    assert.ok(lesson.practice.length > 10);
    for (const q of lesson.quiz) {
      assert.ok(q.question.length > 0);
      assert.ok(q.correctIndex >= 0 && q.correctIndex < q.options.length);
    }
  }
});
test('seller knowledge API enrichment carries draft but does not replace canonical quiz', () => {
  const item = enrichTrainingTask({ code:'KNOW-04', taskType:'KNOWLEDGE', questions:[{id:'original'}] }, '2026-10-11');
  assert.equal(item.pilotLesson.key, 'MISKA-NUTR-01');
  assert.equal(item.pilotLesson.status, 'DRAFT_REVIEW_REQUIRED');
  assert.deepEqual(item.questions, [{id:'original'}]);
});
test('UI preview is owner-only', () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  assert.match(source, /ownerMode && task\.pilotLesson\?\.status === 'DRAFT_REVIEW_REQUIRED'/);
  assert.match(source, /Черновик урока для проверки/);
});
