'use strict';

const {
  DuplicateSkillError,
  SkillNotFoundError,
} = require('../errors/arthur_errors');
const { validateSkillContract } = require('./skill_contract');

class SkillRegistry {
  constructor(options = {}) {
    this.skills = new Map();
    this.logger = options.logger || null;
  }

  register(skill) {
    validateSkillContract(skill);
    if (this.skills.has(skill.id)) {
      throw new DuplicateSkillError(skill.id);
    }
    this.skills.set(skill.id, skill);
    if (this.logger) {
      this.logger.info('skill_registered', null, {
        skillId: skill.id,
        skillName: skill.name,
        skillVersion: skill.version,
        capabilities: skill.capabilities.map(c => c.id),
      });
    }
    return skill;
  }

  unregister(skillId) {
    if (!this.skills.has(skillId)) {
      throw new SkillNotFoundError(skillId);
    }
    this.skills.delete(skillId);
    if (this.logger) {
      this.logger.info('skill_unregistered', null, { skillId });
    }
    return true;
  }

  get(skillId) {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new SkillNotFoundError(skillId);
    }
    return skill;
  }

  has(skillId) {
    return this.skills.has(skillId);
  }

  list() {
    return Array.from(this.skills.values()).map(skill => ({
      id: skill.id,
      name: skill.name,
      version: skill.version,
      capabilities: skill.capabilities,
    }));
  }

  findByCapability(capabilityId) {
    return Array.from(this.skills.values()).filter(skill =>
      skill.capabilities.some(capability => capability.id === capabilityId)
    );
  }
}

function createSkillRegistry(options = {}) {
  return new SkillRegistry(options);
}

module.exports = {
  SkillRegistry,
  createSkillRegistry,
};
