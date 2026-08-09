'use strict';

const { DataFabricationGuardError } = require('../errors/arthur_errors');

function createSources(stepResults) {
  return Object.entries(stepResults).map(([stepId, result]) => ({
    stepId,
    skill: result.skill,
    operation: result.operation,
    status: result.status,
    metadata: result.metadata,
  }));
}

function validateNoFabrication(answer, stepResults) {
  if (!answer || typeof answer !== 'object') {
    throw new DataFabricationGuardError('Synthesized answer must be an object');
  }
  if (answer.fabricated === true) {
    throw new DataFabricationGuardError('Synthesized answer marked itself as fabricated');
  }
  return answer;
}

class Synthesizer {
  constructor(options = {}) {
    this.aiProvider = options.aiProvider || null;
    this.logger = options.logger || null;
  }

  async synthesize(request, executionResult, knowledgeResults) {
    const { context, message, intent } = request;
    const stepResults = executionResult.stepResults || {};

    if (this.logger) {
      this.logger.info('synthesis_started', context, {
        intent,
        stepCount: Object.keys(stepResults).length,
        executionStatus: executionResult.status,
      });
    }

    const successfulResults = Object.entries(stepResults)
      .filter(([, result]) => result.status === 'success')
      .map(([stepId, result]) => ({
        stepId,
        skill: result.skill,
        operation: result.operation,
        data: result.data,
      }));

    const failedResults = Object.entries(stepResults)
      .filter(([, result]) => result.status !== 'success')
      .map(([stepId, result]) => ({
        stepId,
        skill: result.skill,
        operation: result.operation,
        status: result.status,
        errors: result.errors,
      }));

    const synthesisInput = {
      userMessage: message,
      intent,
      context: {
        userId: context.userId,
        channel: context.channel,
      },
      knowledge: knowledgeResults?.entries || [],
      skillOutputs: successfulResults,
      failures: failedResults,
      executionStatus: executionResult.status,
    };

    let answer;
    if (this.aiProvider) {
      answer = await this.aiProvider.synthesize(synthesisInput, context);
    } else {
      answer = this._fallbackSynthesize(synthesisInput);
    }

    validateNoFabrication(answer, stepResults);

    if (this.logger) {
      this.logger.info('synthesis_completed', context, {
        intent,
        executionStatus: executionResult.status,
        answerLength: answer.text?.length,
      });
    }

    return {
      text: answer.text,
      markdown: answer.markdown || answer.text,
      sources: createSources(stepResults),
      confidence: answer.confidence || 'medium',
      followUps: answer.followUps || [],
    };
  }

  _fallbackSynthesize(input) {
    const { skillOutputs, failures, executionStatus, userMessage } = input;
    const lines = [];

    if (executionStatus === 'failed') {
      lines.push('Не удалось получить данные для ответа.');
    } else if (executionStatus === 'partial') {
      lines.push('Ответ составлен на основе частичных данных.');
    }

    for (const output of skillOutputs) {
      if (output.data && typeof output.data.summary === 'string') {
        lines.push(`${output.skill}: ${output.data.summary}`);
      } else if (output.data && typeof output.data.status === 'string') {
        lines.push(`${output.skill}: ${output.data.status}`);
      } else {
        lines.push(`${output.skill}: данные получены`);
      }
    }

    for (const failure of failures) {
      lines.push(`${failure.skill}.${failure.operation}: недоступно (${failure.status})`);
    }

    if (lines.length === 0) {
      lines.push('Нет данных для формирования ответа.');
    }

    return {
      text: lines.join('\n'),
      confidence: executionStatus === 'success' ? 'medium' : 'low',
      followUps: [],
    };
  }
}

function createSynthesizer(options = {}) {
  return new Synthesizer(options);
}

module.exports = {
  Synthesizer,
  createSynthesizer,
  createSources,
  validateNoFabrication,
};
