'use strict';

const { createOrchestrator } = require('./orchestrator/orchestrator');
const { createSkillRegistry } = require('./registry/skill_registry');
const { createRuleBasedPlanBuilder } = require('./planner/plan_builder');
const { createLLMPlanBuilder } = require('./planner/llm_plan_builder');
const { createKnowledgeService } = require('./knowledge/knowledge_service');
const { createMemoryInterface } = require('./memory/memory_interface');
const { createLogger } = require('./logging/logger');
const { PurchasingSkill } = require('./skills/purchasing/purchasing_skill');
const { createArthurCoreClient, validateCoreClientOptions } = require('./skills/arthur-core/core_client');
const { createArthurCoreSkill } = require('./skills/arthur-core/arthur_core_skill');
const { createFakeAIProvider } = require('./ai/fake_provider');
const { createAIProviderFromEnv, getProviderDiagnostics } = require('./ai/provider_factory');

/**
 * Arthur v1.0 public entry point.
 *
 * Returns a pre-configured orchestrator with the purchasing skill
 * and file-backed knowledge. All operations are read-only.
 *
 * AI provider is selected from environment via ARTHUR_AI_PROVIDER.
 * Deterministic intents bypass the LLM planner.
 */
function createArthurV1(options = {}) {
  const registry = createSkillRegistry();
  registry.register(PurchasingSkill);

  const coreConfig = options.coreConfig || {};
  const coreValidation = validateCoreClientOptions(coreConfig);
  const hasOwnerProfileId = typeof coreConfig.ownerProfileId === 'string'
    && coreConfig.ownerProfileId.trim() !== '';

  if (coreValidation.valid && hasOwnerProfileId) {
    const client = options.coreClient || createArthurCoreClient(coreConfig);
    registry.register(createArthurCoreSkill({
      client,
      ownerProfileId: coreConfig.ownerProfileId,
    }));
  }

  const knowledgeDirectories = options.knowledgeDirectories || [
    'docs',
    'knowledge',
  ];

  const logger = options.logger || createLogger();
  const aiProvider = options.aiProvider || createAIProviderFromEnv(process.env, { logger });

  return createOrchestrator({
    registry,
    deterministicPlanBuilder: createRuleBasedPlanBuilder({
      availableSkills: registry.list().map(skill => skill.id),
    }),
    llmPlanBuilder: createLLMPlanBuilder({
      aiProvider,
      registry,
    }),
    knowledge: createKnowledgeService({
      directories: knowledgeDirectories,
      files: options.knowledgeFiles || [],
      logger,
    }),
    memory: options.memory || createMemoryInterface(),
    aiProvider,
    logger,
  });
}

module.exports = {
  createArthurV1,
  createOrchestrator,
  createSkillRegistry,
  createRuleBasedPlanBuilder,
  createLLMPlanBuilder,
  createKnowledgeService,
  createMemoryInterface,
  createLogger,
  createFakeAIProvider,
  createAIProviderFromEnv,
  getProviderDiagnostics,
  PurchasingSkill,
  createArthurCoreClient,
  createArthurCoreSkill,
};
