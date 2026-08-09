'use strict';

const {
  InvalidSkillContractError,
} = require('../errors/arthur_errors');

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'name',
  'version',
  'capabilities',
  'execute',
  'health',
]);

function validateSkillContract(skill) {
  if (!skill || typeof skill !== 'object') {
    throw new InvalidSkillContractError('?', 'skill must be an object');
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in skill)) {
      throw new InvalidSkillContractError(skill.id || '?', `missing required field: ${field}`);
    }
  }

  if (typeof skill.id !== 'string' || skill.id.trim() === '') {
    throw new InvalidSkillContractError(skill.id || '?', 'id must be a non-empty string');
  }

  if (typeof skill.name !== 'string' || skill.name.trim() === '') {
    throw new InvalidSkillContractError(skill.id, 'name must be a non-empty string');
  }

  if (typeof skill.version !== 'string' || skill.version.trim() === '') {
    throw new InvalidSkillContractError(skill.id, 'version must be a non-empty string');
  }

  if (!Array.isArray(skill.capabilities) || skill.capabilities.length === 0) {
    throw new InvalidSkillContractError(skill.id, 'capabilities must be a non-empty array');
  }

  for (const capability of skill.capabilities) {
    if (!capability || typeof capability.id !== 'string' || capability.id.trim() === '') {
      throw new InvalidSkillContractError(skill.id, 'each capability must have a non-empty id');
    }
    if (typeof capability.readOnly !== 'boolean') {
      throw new InvalidSkillContractError(skill.id, `capability ${capability.id} must declare readOnly boolean`);
    }
  }

  if (typeof skill.execute !== 'function') {
    throw new InvalidSkillContractError(skill.id, 'execute must be a function');
  }

  if (typeof skill.health !== 'function') {
    throw new InvalidSkillContractError(skill.id, 'health must be a function');
  }

  return skill;
}

module.exports = {
  validateSkillContract,
  REQUIRED_FIELDS,
};
