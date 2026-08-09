'use strict';

const { createOrchestrator } = require('./orchestrator/orchestrator');
const { createSkillRegistry } = require('./registry/skill_registry');
const { createRuleBasedPlanBuilder } = require('./planner/plan_builder');
const { createKnowledgeService } = require('./knowledge/knowledge_service');
const { createMemoryInterface } = require('./memory/memory_interface');
const { createLogger } = require('./logging/logger');
const { PurchasingSkill } = require('./skills/purchasing/purchasing_skill');
const { createFakeAIProvider } = require('./ai/fake_provider');

/**
 * Arthur v1.0 public entry point.
 *
 * Returns a pre-configured orchestrator with the purchasing skill
 * and file-backed knowledge. All operations are read-only.
 */
function createArthurV1(options = {}) {
  const registry = createSkillRegistry();
  registry.register(PurchasingSkill);

  const knowledgeDirectories = options.knowledgeDirectories || [
    'docs',
    'knowledge',
  ];

  return createOrchestrator({
    registry,
    planBuilder: createRuleBasedPlanBuilder(),
    knowledge: createKnowledgeService({
      directories: knowledgeDirectories,
      files: options.knowledgeFiles || [],
      logger: options.logger,
    }),
    memory: options.memory || createMemoryInterface(),
    aiProvider: options.aiProvider || createFakeAIProvider(),
    logger: options.logger || createLogger(),
  });
}

module.exports = {
  createArthurV1,
  createOrchestrator,
  createSkillRegistry,
  createRuleBasedPlanBuilder,
  createKnowledgeService,
  createMemoryInterface,
  createLogger,
  createFakeAIProvider,
  PurchasingSkill,
};
