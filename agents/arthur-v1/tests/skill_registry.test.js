'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { createSkillRegistry } = require('../registry/skill_registry');
const {
  DuplicateSkillError,
  InvalidSkillContractError,
  SkillNotFoundError,
} = require('../errors/arthur_errors');

function validSkill(overrides = {}) {
  return {
    id: 'test-skill',
    name: 'Test Skill',
    version: '1.0.0',
    capabilities: [{ id: 'doThing', readOnly: true }],
    execute: async () => ({ status: 'success', data: {} }),
    health: async () => ({ healthy: true }),
    ...overrides,
  };
}

test('register stores skill and returns it', () => {
  const registry = createSkillRegistry();
  const skill = validSkill();
  const result = registry.register(skill);
  assert.equal(result.id, 'test-skill');
  assert.ok(registry.has('test-skill'));
});

test('duplicate skill is rejected', () => {
  const registry = createSkillRegistry();
  registry.register(validSkill());
  assert.throws(
    () => registry.register(validSkill()),
    DuplicateSkillError
  );
});

test('invalid contract without id is rejected', () => {
  const registry = createSkillRegistry();
  assert.throws(
    () => registry.register({ ...validSkill(), id: '' }),
    InvalidSkillContractError
  );
});

test('invalid contract without execute is rejected', () => {
  const registry = createSkillRegistry();
  const skill = validSkill();
  delete skill.execute;
  assert.throws(
    () => registry.register(skill),
    InvalidSkillContractError
  );
});

test('invalid contract without capability readOnly is rejected', () => {
  const registry = createSkillRegistry();
  const skill = validSkill({
    capabilities: [{ id: 'doThing' }],
  });
  assert.throws(
    () => registry.register(skill),
    InvalidSkillContractError
  );
});

test('get returns skill by id', () => {
  const registry = createSkillRegistry();
  registry.register(validSkill());
  const skill = registry.get('test-skill');
  assert.equal(skill.name, 'Test Skill');
});

test('get throws for missing skill', () => {
  const registry = createSkillRegistry();
  assert.throws(
    () => registry.get('missing'),
    SkillNotFoundError
  );
});

test('unregister removes skill', () => {
  const registry = createSkillRegistry();
  registry.register(validSkill());
  registry.unregister('test-skill');
  assert.equal(registry.has('test-skill'), false);
});

test('unregister throws for missing skill', () => {
  const registry = createSkillRegistry();
  assert.throws(
    () => registry.unregister('missing'),
    SkillNotFoundError
  );
});

test('list returns skills without execute/health functions', () => {
  const registry = createSkillRegistry();
  registry.register(validSkill());
  const list = registry.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'test-skill');
  assert.equal(list[0].execute, undefined);
  assert.equal(list[0].health, undefined);
  assert.deepEqual(list[0].capabilities, [{ id: 'doThing', readOnly: true }]);
});

test('findByCapability returns matching skills', () => {
  const registry = createSkillRegistry();
  registry.register(validSkill({ id: 'skill-a', capabilities: [{ id: 'read', readOnly: true }] }));
  registry.register(validSkill({ id: 'skill-b', capabilities: [{ id: 'write', readOnly: false }] }));
  const found = registry.findByCapability('read');
  assert.equal(found.length, 1);
  assert.equal(found[0].id, 'skill-a');
});
