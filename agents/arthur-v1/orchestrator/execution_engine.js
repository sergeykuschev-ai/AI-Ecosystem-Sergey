'use strict';

const {
  SkillExecutionError,
  SkillTimeoutError,
} = require('../errors/arthur_errors');

function topologicalSort(steps) {
  const visited = new Set();
  const visiting = new Set();
  const result = [];

  const stepById = new Map(steps.map(step => [step.id, step]));

  function visit(stepId) {
    if (visiting.has(stepId)) {
      throw new Error(`Circular dependency detected at step ${stepId}`);
    }
    if (visited.has(stepId)) return;
    visiting.add(stepId);
    const step = stepById.get(stepId);
    if (!step) {
      throw new Error(`Step not found: ${stepId}`);
    }
    for (const dep of step.dependsOn || []) {
      visit(dep);
    }
    visiting.delete(stepId);
    visited.add(stepId);
    result.push(step);
  }

  for (const step of steps) {
    visit(step.id);
  }

  return result;
}

function groupStepsByLevel(sortedSteps) {
  const completed = new Set();
  const levels = [];
  let remaining = [...sortedSteps];

  while (remaining.length > 0) {
    const level = remaining.filter(step =>
      (step.dependsOn || []).every(dep => completed.has(dep))
    );
    if (level.length === 0) {
      throw new Error('Unable to schedule steps; possible circular dependency');
    }
    levels.push(level);
    for (const step of level) {
      completed.add(step.id);
    }
    remaining = remaining.filter(step => !completed.has(step.id));
  }

  return levels;
}

async function executeWithTimeout(skill, input, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new SkillTimeoutError(skill.id, input.operation, timeoutMs));
    }, timeoutMs);

    Promise.resolve(skill.execute(input))
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function executeStep(skill, step, context, stepResults, logger) {
  const input = {
    correlationId: context.correlationId,
    requestId: context.requestId,
    actor: {
      userId: context.userId,
      channel: context.channel,
    },
    operation: step.operation,
    parameters: step.parameters || {},
    context: Object.fromEntries(stepResults),
  };

  const timeoutMs = step.timeoutMs || 10000;
  const maxRetries = step.retries ?? (step.retryable ? 2 : 0);

  if (logger) {
    logger.info('skill_execution_started', context, {
      stepId: step.id,
      skill: skill.id,
      operation: step.operation,
      timeoutMs,
      maxRetries,
    });
  }

  const startTime = Date.now();
  let lastError = null;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await executeWithTimeout(skill, input, timeoutMs);
      const durationMs = Date.now() - startTime;
      if (logger) {
        logger.info('skill_execution_completed', context, {
          stepId: step.id,
          skill: skill.id,
          operation: step.operation,
          durationMs,
          attempt,
        });
      }
      return {
        skill: skill.id,
        operation: step.operation,
        status: result.status || 'success',
        data: result.data,
        metadata: {
          ...result.metadata,
          durationMs,
          attempt,
        },
      };
    } catch (error) {
      lastError = error;
      const durationMs = Date.now() - startTime;
      const retryable = error.retryable ?? false;
      if (logger) {
        logger.warn('skill_execution_attempt_failed', context, {
          stepId: step.id,
          skill: skill.id,
          operation: step.operation,
          attempt,
          errorCode: error.code || error.name,
          errorMessage: error.message,
          retryable,
        });
      }
      if (!retryable || attempt >= maxRetries) {
        break;
      }
      await delay(250 * Math.pow(2, attempt));
    }
  }

  const durationMs = Date.now() - startTime;
  const wrappedError = new SkillExecutionError(
    skill.id,
    step.operation,
    lastError,
    lastError?.retryable ?? false
  );

  if (logger) {
    logger.error('skill_execution_failed', context, {
      stepId: step.id,
      skill: skill.id,
      operation: step.operation,
      durationMs,
      errorCode: wrappedError.code,
      errorMessage: wrappedError.message,
    });
  }

  return {
    skill: skill.id,
    operation: step.operation,
    status: 'error',
    data: null,
    metadata: { durationMs, attempt: maxRetries },
    errors: [{
      code: wrappedError.code,
      message: wrappedError.message,
      retryable: wrappedError.retryable,
    }],
  };
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ExecutionEngine {
  constructor(options = {}) {
    this.maxConcurrency = options.maxConcurrency || 5;
    this.logger = options.logger || null;
  }

  async execute(plan, registry, context) {
    const sortedSteps = topologicalSort(plan.steps);
    const levels = groupStepsByLevel(sortedSteps);
    const stepResults = new Map();
    const errors = [];

    for (const level of levels) {
      const promises = level.map(async step => {
        const skill = registry.get(step.skill);
        const result = await executeStep(skill, step, context, stepResults, this.logger);
        stepResults.set(step.id, result);
        if (result.status === 'error') {
          errors.push({
            stepId: step.id,
            skill: step.skill,
            operation: step.operation,
            errors: result.errors,
          });
        }
        return { stepId: step.id, result };
      });

      const batchSize = Math.min(level.length, this.maxConcurrency);
      const batches = [];
      for (let i = 0; i < promises.length; i += batchSize) {
        batches.push(promises.slice(i, i + batchSize));
      }

      for (const batch of batches) {
        await Promise.all(batch);
      }
    }

    const hasErrors = errors.length > 0;
    const hasSuccess = Array.from(stepResults.values()).some(r => r.status === 'success');

    return {
      stepResults: Object.fromEntries(stepResults),
      errors,
      status: hasErrors
        ? (hasSuccess ? 'partial' : 'failed')
        : 'success',
    };
  }
}

function createExecutionEngine(options = {}) {
  return new ExecutionEngine(options);
}

module.exports = {
  ExecutionEngine,
  createExecutionEngine,
  topologicalSort,
  groupStepsByLevel,
};
