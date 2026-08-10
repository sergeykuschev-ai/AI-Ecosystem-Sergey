'use strict';

const { validateContext, createArthurContext } = require('../context/arthur_context');
const { createExecutionEngine } = require('./execution_engine');
const { createSynthesizer } = require('./synthesizer');
const { INTENTS, detectIntent, isDeterministicIntent } = require('../planner/intents');
const { createRuleBasedPlanBuilder } = require('../planner/plan_builder');
const { createLLMPlanBuilder } = require('../planner/llm_plan_builder');
const { getProviderDiagnostics } = require('../ai/provider_factory');

function createOrchestratorRequest(input = {}) {
  const ctx = createArthurContext(input);
  return {
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
    userId: input.userId || ctx.userId,
    channel: ctx.channel,
    message: input.message || '',
    intent: input.intent || null,
    context: {
      ...(input.context || {}),
      userId: input.userId || ctx.userId,
      channel: ctx.channel,
    },
    metadata: input.metadata || {},
  };
}

function createOrchestratorResponse({
  request,
  status,
  answer,
  modulesUsed,
  diagnostics,
  executionTimeMs,
}) {
  return {
    requestId: request.requestId,
    correlationId: request.correlationId,
    status,
    answer,
    modulesUsed,
    diagnostics,
    executionTimeMs,
  };
}

class ArthurOrchestrator {
  constructor(options = {}) {
    this.registry = options.registry;
    this.planBuilder = options.planBuilder;
    this.deterministicPlanBuilder = options.deterministicPlanBuilder || createRuleBasedPlanBuilder();
    this.llmPlanBuilder = options.llmPlanBuilder || null;
    this.knowledge = options.knowledge || null;
    this.memory = options.memory || null;
    this.aiProvider = options.aiProvider || null;
    this.logger = options.logger || null;
    this.engine = createExecutionEngine({
      maxConcurrency: options.maxConcurrency,
      logger: this.logger,
    });
    this.synthesizer = createSynthesizer({
      aiProvider: this.aiProvider,
      logger: this.logger,
    });

    if (!this.llmPlanBuilder && this.aiProvider && this.registry) {
      this.llmPlanBuilder = createLLMPlanBuilder({
        aiProvider: this.aiProvider,
        registry: this.registry,
      });
    }
  }

  async _buildPlan(request) {
    if (this.planBuilder) {
      return this.planBuilder.build(request);
    }

    const intent = request.intent || detectIntent(request.message);

    if (isDeterministicIntent(intent)) {
      return this.deterministicPlanBuilder.build({
        ...request,
        intent,
      });
    }

    if (this.llmPlanBuilder) {
      try {
        return await this.llmPlanBuilder.build(request);
      } catch (error) {
        if (this.logger) {
          this.logger.warn('llm_plan_failed', request, {
            errorCode: error.code || error.name,
            errorMessage: error.message,
          });
        }
      }
    }

    return this.deterministicPlanBuilder.build({
      ...request,
      intent: INTENTS.UNKNOWN,
    });
  }

  async getDiagnostics() {
    const providerHealth = this.aiProvider ? await this.aiProvider.health() : { healthy: false, provider: 'none' };
    return {
      aiProviderEnabled: Boolean(this.aiProvider),
      provider: providerHealth.provider || getProviderDiagnostics().provider,
      model: providerHealth.model || null,
      status: providerHealth.healthy ? 'healthy' : 'unavailable',
      skills: this.registry ? this.registry.list().map(s => s.id) : [],
    };
  }

  async handle(input) {
    const startTime = Date.now();
    const request = createOrchestratorRequest(input);
    validateContext(request);

    if (this.logger) {
      this.logger.info('orchestrator_request_received', request, {
        intent: request.intent,
        messageLength: request.message.length,
      });
    }

    try {
      const memorySnapshot = this.memory
        ? await this.memory.load(request.userId, request.correlationId)
        : [];

      const knowledgeResults = this.knowledge && request.intent
        ? await this.knowledge.search({
            topic: request.intent,
            userId: request.userId,
            limit: 10,
          })
        : { entries: [] };

      const plan = await this._buildPlan(request);

      if (this.logger) {
        this.logger.info('execution_plan_built', request, {
          stepCount: plan.steps.length,
          steps: plan.steps.map(s => ({ id: s.id, skill: s.skill, operation: s.operation })),
        });
      }

      const executionResult = await this.engine.execute(plan, this.registry, request);

      const answer = await this.synthesizer.synthesize(
        request,
        executionResult,
        knowledgeResults
      );

      const modulesUsed = Object.values(executionResult.stepResults)
        .filter(r => r.status === 'success')
        .map(r => r.skill);

      const response = createOrchestratorResponse({
        request,
        status: executionResult.status,
        answer,
        modulesUsed: [...new Set(modulesUsed)],
        diagnostics: {
          executionStatus: executionResult.status,
          errors: executionResult.errors,
          knowledgeEntries: knowledgeResults.entries.length,
          memoryEntries: memorySnapshot.length,
        },
        executionTimeMs: Date.now() - startTime,
      });

      if (this.memory) {
        await this.memory.store(request.userId, request.correlationId, {
          request: request.message,
          intent: request.intent,
          answer: answer.text,
          status: response.status,
          timestamp: new Date().toISOString(),
        });
      }

      if (this.logger) {
        this.logger.info('orchestrator_response_sent', request, {
          status: response.status,
          executionTimeMs: response.executionTimeMs,
          modulesUsed: response.modulesUsed,
        });
      }

      return response;
    } catch (error) {
      if (this.logger) {
        this.logger.error('orchestrator_request_failed', request, {
          errorCode: error.code || error.name,
          errorMessage: error.message,
        });
      }

      return createOrchestratorResponse({
        request,
        status: 'failed',
        answer: {
          text: 'Произошла ошибка при обработке запроса. Попробуйте позже или обратитесь к администратору.',
          markdown: 'Произошла ошибка при обработке запроса.',
          sources: [],
          confidence: 'low',
          followUps: [],
        },
        modulesUsed: [],
        diagnostics: {
          executionStatus: 'failed',
          errors: [{
            code: error.code || 'ORCHESTRATOR_ERROR',
            message: error.message,
          }],
        },
        executionTimeMs: Date.now() - startTime,
      });
    }
  }
}

function createOrchestrator(options = {}) {
  return new ArthurOrchestrator(options);
}

module.exports = {
  ArthurOrchestrator,
  createOrchestrator,
  createOrchestratorRequest,
  createOrchestratorResponse,
};
