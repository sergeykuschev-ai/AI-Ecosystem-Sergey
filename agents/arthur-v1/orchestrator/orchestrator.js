'use strict';

const { validateContext, createArthurContext } = require('../context/arthur_context');
const { createExecutionEngine } = require('./execution_engine');
const { createSynthesizer } = require('./synthesizer');
const { INTENTS, detectIntent, isDeterministicIntent } = require('../planner/intents');
const {
  createExecutionPlan,
  createRuleBasedPlanBuilder,
  createStep,
} = require('../planner/plan_builder');
const { parseTaskClarificationReply } = require('../planner/task_management_parser');
const { createLLMPlanBuilder } = require('../planner/llm_plan_builder');
const { getProviderDiagnostics } = require('../ai/provider_factory');
const { buildDirectResponseSystemMessage } = require('../identity/arthur_identity');

function createOrchestratorRequest(input = {}) {
  const ctx = createArthurContext(input);
  return {
    requestId: ctx.requestId,
    correlationId: ctx.correlationId,
    conversationId: ctx.conversationId,
    userId: input.userId || ctx.userId,
    channel: ctx.channel,
    message: input.message || '',
    intent: input.intent || null,
    context: {
      ...(input.context || {}),
      userId: input.userId || ctx.userId,
      conversationId: ctx.conversationId,
      channel: ctx.channel,
    },
    transport: ctx.transport,
    metadata: ctx.metadata,
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
    conversationId: request.conversationId,
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
    this.ownerProfileId = options.ownerProfileId || null;
    this.aiProvider = options.aiProvider || null;
    this.logger = options.logger || null;
    this.engine = createExecutionEngine({
      maxConcurrency: options.maxConcurrency,
      logger: this.logger,
    });
    this.synthesizer = createSynthesizer({
      aiProvider: this.aiProvider,
      logger: this.logger,
      registry: this.registry,
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
    const envDiagnostics = getProviderDiagnostics();
    return {
      aiProviderEnabled: Boolean(this.aiProvider),
      provider: providerHealth.provider || envDiagnostics.provider,
      models: providerHealth.models || envDiagnostics.models,
      status: providerHealth.healthy ? 'healthy' : 'unavailable',
      skills: this.registry ? this.registry.list().map(s => s.id) : [],
    };
  }

  _getAvailableSkills() {
    return this.registry ? this.registry.list() : [];
  }

  _buildSafeFallbackText(skills) {
    return 'Я временно не могу сформулировать ответ. Попробуйте позже.';
  }

  async _respondWithText(request, text, memorySnapshot, startTime, reason) {
    const answer = {
      text,
      markdown: text,
      sources: [],
      confidence: 'high',
      followUps: [],
    };
    const response = createOrchestratorResponse({
      request,
      status: 'success',
      answer,
      modulesUsed: [],
      diagnostics: {
        executionStatus: 'success',
        errors: [],
        knowledgeEntries: 0,
        memoryEntries: memorySnapshot.length,
        directResponse: true,
        reason,
      },
      executionTimeMs: Date.now() - startTime,
    });

    if (this.memory) {
      await this.memory.store(request.userId, request.conversationId, {
        request: request.message,
        intent: request.intent,
        answer: text,
        status: response.status,
        timestamp: new Date().toISOString(),
      });
    }
    return response;
  }

  async _resolvePendingTaskClarification(request, memorySnapshot, startTime) {
    if (!this.memory
      || typeof this.memory.loadPendingTaskClarification !== 'function'
      || typeof this.memory.clearPendingTaskClarification !== 'function') {
      return null;
    }
    const ownerId = this.ownerProfileId || request.userId;
    if (!ownerId) return null;
    const pending = await this.memory.loadPendingTaskClarification(ownerId, request.conversationId);
    if (!pending) return null;
    if (pending.ownerId !== ownerId || pending.conversationId !== request.conversationId) {
      await this.memory.clearPendingTaskClarification(ownerId, request.conversationId);
      return null;
    }

    const reply = parseTaskClarificationReply(request.message);
    if (!reply) {
      await this.memory.clearPendingTaskClarification(ownerId, request.conversationId);
      return null;
    }
    if (reply.type === 'cancel') {
      await this.memory.clearPendingTaskClarification(ownerId, request.conversationId);
      return {
        response: await this._respondWithText(
          request,
          'Хорошо, отменил действие.',
          memorySnapshot,
          startTime,
          'task_clarification_cancelled'
        ),
      };
    }

    const candidate = pending.candidates[reply.taskNumber - 1];
    if (!candidate) {
      return {
        response: await this._respondWithText(
          request,
          `Выбери номер от 1 до ${pending.candidates.length}.`,
          memorySnapshot,
          startTime,
          'task_clarification_invalid_selection'
        ),
      };
    }

    // Consume before the write so a repeated Telegram delivery cannot replay the mutation.
    await this.memory.clearPendingTaskClarification(ownerId, request.conversationId);
    return {
      plan: createExecutionPlan([
        createStep({
          id: 'step_1',
          skill: 'arthur-core',
          operation: pending.operation,
          parameters: {
            ...pending.parameters,
            taskId: candidate.id,
            expectedTask: { ...candidate },
          },
          timeoutMs: 10000,
        }),
      ]),
    };
  }

  async _storePendingTaskClarification(request, executionResult) {
    if (!this.memory || typeof this.memory.storePendingTaskClarification !== 'function') return;
    const ownerId = this.ownerProfileId || request.userId;
    if (!ownerId) return;
    const pending = Object.values(executionResult.stepResults || {})
      .find(result => result.status === 'success' && result.data?.pendingClarification)
      ?.data?.pendingClarification;
    if (pending) {
      await this.memory.storePendingTaskClarification(ownerId, request.conversationId, pending);
    }
  }

  async _respondDirectly(request, knowledgeResults, memorySnapshot, startTime, reason = 'empty_plan') {
    if (this.logger) {
      this.logger.info('conversation_fallback_used', request, {
        reason,
        intent: request.intent,
        channel: request.channel,
      });
    }

    const skills = this._getAvailableSkills();
    const systemMessage = buildDirectResponseSystemMessage({ skills });

    let answerText;
    let confidence = 'medium';

    if (this.aiProvider) {
      try {
        answerText = await this.aiProvider.generate(request.message, { policy: 'fast', system: systemMessage });
        confidence = 'medium';
      } catch (error) {
        if (this.logger) {
          this.logger.warn('direct_ai_response_failed', request, {
            errorCode: error.code || error.name,
            errorMessage: error.message,
          });
        }
        answerText = this._buildSafeFallbackText(skills);
        confidence = 'low';
      }
    } else {
      answerText = this._buildSafeFallbackText(skills);
      confidence = 'low';
    }

    const answer = {
      text: answerText,
      markdown: answerText,
      sources: [],
      confidence,
      followUps: [],
    };

    const response = createOrchestratorResponse({
      request,
      status: 'success',
      answer,
      modulesUsed: [],
      diagnostics: {
        executionStatus: 'success',
        errors: [],
        knowledgeEntries: knowledgeResults?.entries?.length || 0,
        memoryEntries: memorySnapshot.length,
        directResponse: true,
      },
      executionTimeMs: Date.now() - startTime,
    });

    if (this.memory) {
      await this.memory.store(request.userId, request.conversationId, {
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
        directResponse: true,
      });
    }

    return response;
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
        ? await this.memory.load(request.userId, request.conversationId)
        : [];

      const continuation = await this._resolvePendingTaskClarification(
        request,
        memorySnapshot,
        startTime
      );
      if (continuation?.response) return continuation.response;

      const knowledgeResults = this.knowledge && request.intent
        ? await this.knowledge.search({
            topic: request.intent,
            userId: request.userId,
            limit: 10,
          })
        : { entries: [] };

      const plan = continuation?.plan || await this._buildPlan(request);

      if (this.logger) {
        this.logger.info('execution_plan_built', request, {
          stepCount: plan.steps.length,
          steps: plan.steps.map(s => ({ id: s.id, skill: s.skill, operation: s.operation })),
        });
      }

      if (plan.steps.length === 0) {
        return this._respondDirectly(request, knowledgeResults, memorySnapshot, startTime, 'empty_plan');
      }

      const executionResult = await this.engine.execute(plan, this.registry, request);
      await this._storePendingTaskClarification(request, executionResult);

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
        await this.memory.store(request.userId, request.conversationId, {
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
