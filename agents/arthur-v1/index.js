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
const { createMailSkill } = require('./skills/mail/mail_skill');
const { createMailboxRegistry } = require('./skills/mail/mailbox_registry');
const { createYandexMailSkillFromConfig } = require('./skills/mail/mail_runtime');
const { normalizeMailMessage } = require('./skills/mail/message_normalizer');
const { analyzeImportantMail } = require('./skills/mail/mail_analysis');
const { createSenderAliasRegistry } = require('./skills/mail/sender_alias_registry');
const { createIMAPAdapter } = require('./skills/mail/providers/imap_adapter');
const { createFakeGmailAdapter } = require('./skills/mail/providers/fake_gmail_adapter');
const { createFakeYandexAdapter } = require('./skills/mail/providers/fake_yandex_adapter');
const { createFakeAIProvider } = require('./ai/fake_provider');
const { createAIProviderFromEnv, getProviderDiagnostics } = require('./ai/provider_factory');

/**
 * Arthur v1.0 public entry point.
 *
 * Returns a pre-configured orchestrator with the purchasing skill
 * and file-backed knowledge. Task writes are limited to creating, completing,
 * cancelling and rescheduling internal tasks for the configured owner profile.
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
      ownerTimezone: coreConfig.ownerTimezone,
    }));
  }

  // Mail is opt-in. Tests may inject fake adapters; the Telegram Gateway may
  // inject the configured real adapter. No mail provider is registered by default.
  if (options.mailSkill) {
    registry.register(options.mailSkill);
  }

  const knowledgeDirectories = options.knowledgeDirectories || [
    'docs',
    'knowledge',
  ];

  const logger = options.logger || createLogger();
  const aiProvider = options.aiProvider || createAIProviderFromEnv(process.env, { logger });

  const memory = options.memory || createMemoryInterface({
    clock: options.clock,
    pendingMailActionTtlMs: options.pendingMailActionTtlMs,
    pendingTaskClarificationTtlMs: options.pendingTaskClarificationTtlMs,
  });

  return createOrchestrator({
    registry,
    ownerProfileId: hasOwnerProfileId ? coreConfig.ownerProfileId : null,
    deterministicPlanBuilder: createRuleBasedPlanBuilder({
      availableSkills: registry.list().map(skill => skill.id),
      clock: options.clock,
      ownerTimezone: coreConfig.ownerTimezone,
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
    memory,
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
  createMailSkill,
  createMailboxRegistry,
  createYandexMailSkillFromConfig,
  createIMAPAdapter,
  normalizeMailMessage,
  analyzeImportantMail,
  createSenderAliasRegistry,
  createFakeGmailAdapter,
  createFakeYandexAdapter,
};
