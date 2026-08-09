'use strict';

class ArthurError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = 'ArthurError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.skill = options.skill ?? null;
    this.operation = options.operation ?? null;
    this.cause = options.cause ?? null;
  }
}

class SkillNotFoundError extends ArthurError {
  constructor(skillId) {
    super(
      'SKILL_NOT_FOUND',
      `Skill not found: ${skillId}`,
      { retryable: false }
    );
  }
}

class InvalidSkillContractError extends ArthurError {
  constructor(skillId, reason) {
    super(
      'INVALID_SKILL_CONTRACT',
      `Invalid skill contract for ${skillId}: ${reason}`,
      { retryable: false }
    );
  }
}

class DuplicateSkillError extends ArthurError {
  constructor(skillId) {
    super(
      'DUPLICATE_SKILL',
      `Skill already registered: ${skillId}`,
      { retryable: false }
    );
  }
}

class SkillExecutionError extends ArthurError {
  constructor(skillId, operation, cause, retryable = false) {
    super(
      'SKILL_EXECUTION_ERROR',
      `Skill execution failed: ${skillId}.${operation}: ${cause?.message || cause}`,
      { retryable, skill: skillId, operation, cause }
    );
  }
}

class SkillTimeoutError extends ArthurError {
  constructor(skillId, operation, timeoutMs) {
    super(
      'SKILL_TIMEOUT',
      `Skill timeout: ${skillId}.${operation} after ${timeoutMs}ms`,
      { retryable: true, skill: skillId, operation }
    );
  }
}

class PlanBuildError extends ArthurError {
  constructor(intent, reason) {
    super(
      'PLAN_BUILD_ERROR',
      `Cannot build plan for intent ${intent}: ${reason}`,
      { retryable: false }
    );
  }
}

class UnsupportedOperationError extends ArthurError {
  constructor(skillId, operation) {
    super(
      'UNSUPPORTED_OPERATION',
      `Operation ${operation} is not supported by skill ${skillId}`,
      { retryable: false, skill: skillId, operation }
    );
  }
}

class DataFabricationGuardError extends ArthurError {
  constructor(message) {
    super(
      'DATA_FABRICATION_GUARD',
      message,
      { retryable: false }
    );
  }
}

module.exports = {
  ArthurError,
  SkillNotFoundError,
  InvalidSkillContractError,
  DuplicateSkillError,
  SkillExecutionError,
  SkillTimeoutError,
  PlanBuildError,
  UnsupportedOperationError,
  DataFabricationGuardError,
};
