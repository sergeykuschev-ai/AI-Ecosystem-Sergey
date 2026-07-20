#!/usr/bin/env node

const path = require('node:path');

const {
  OWNER_DECISIONS,
  appendOwnerDecision,
} = require('../agents/purchasing/matrix_builder/owner_decisions');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_OWNER_DECISIONS_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-owner-decisions.json'
);
const DEFAULT_SOURCE_VERSION = 'miska-matrix-builder-v0.5.3';

class OwnerDecisionCliError extends Error {
  constructor(message, code, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'OwnerDecisionCliError';
    this.code = code;
  }
}

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new OwnerDecisionCliError(
      `Для аргумента ${flag} требуется значение.`,
      'MISSING_ARGUMENT_VALUE'
    );
  }
  return value;
}

function parsePolicy(value) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('ожидается JSON-объект');
    }
    return parsed;
  } catch (error) {
    throw new OwnerDecisionCliError(
      `--policy должен содержать корректный JSON-объект: ${error.message}.`,
      'INVALID_POLICY_JSON',
      error
    );
  }
}

function parseArguments(argv) {
  const parsed = {
    filePath: DEFAULT_OWNER_DECISIONS_PATH,
    sku: null,
    owner_decision: null,
    owner_role_override: null,
    owner_policy_override: null,
    reason: null,
    decided_at: null,
    decided_by: 'store_owner',
    status: 'active',
    source_version: DEFAULT_SOURCE_VERSION,
    help: false,
  };
  const valueFlags = new Set([
    '--file', '--sku', '--decision', '--role', '--policy', '--reason',
    '--decided-at', '--decided-by', '--status', '--source-version',
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      parsed.help = true;
      continue;
    }
    if (!valueFlags.has(argument)) {
      throw new OwnerDecisionCliError(
        `Неизвестный аргумент: ${argument}. Используйте --help.`,
        'UNKNOWN_ARGUMENT'
      );
    }
    const value = requiredValue(argv, index, argument);
    index += 1;
    if (argument === '--file') parsed.filePath = path.resolve(value);
    else if (argument === '--sku') parsed.sku = value;
    else if (argument === '--decision') parsed.owner_decision = value;
    else if (argument === '--role') parsed.owner_role_override = value;
    else if (argument === '--policy') parsed.owner_policy_override = parsePolicy(value);
    else if (argument === '--reason') parsed.reason = value;
    else if (argument === '--decided-at') parsed.decided_at = value;
    else if (argument === '--decided-by') parsed.decided_by = value;
    else if (argument === '--status') parsed.status = value;
    else parsed.source_version = value;
  }
  if (!parsed.help) {
    for (const field of ['sku', 'owner_decision', 'reason']) {
      if (!parsed[field]) {
        throw new OwnerDecisionCliError(
          `Обязательный аргумент отсутствует: ${field}.`,
          'REQUIRED_ARGUMENT'
        );
      }
    }
  }
  return parsed;
}

function helpText() {
  return [
    'Безопасная запись решения владельца по SKU',
    '',
    'Использование:',
    '  node scripts/set-purchasing-owner-decision.js \\',
    '    --sku 7173648 --decision ACCEPT_POLICY --reason "Подтверждено владельцем"',
    '',
    `Решения: ${OWNER_DECISIONS.join(', ')}`,
    '',
    'Параметры:',
    '  --file <путь>             Файл истории решений',
    '  --sku <значение>          Артикул, штрихкод или внутренний ID',
    '  --decision <решение>      Управленческое решение',
    '  --role <роль>             Явный override роли',
    '  --policy <JSON>           Явный override stock policy',
    '  --reason <текст>          Обоснование решения',
    '  --decided-at <ISO>        Время решения; по умолчанию текущее',
    '  --decided-by <имя>        Автор; по умолчанию store_owner',
    '  --status <status>         active или inactive',
    '  --source-version <версия> Версия Builder в момент решения',
    '  --help, -h                Показать справку',
    '',
    'Скрипт только дописывает историю. Предыдущие записи не удаляются.',
  ].join('\n');
}

function runOwnerDecisionCli(argv, dependencies = {}) {
  const output = dependencies.output || console.log;
  const args = parseArguments(argv);
  if (args.help) {
    output(helpText());
    return { mode: 'help', status: 'success' };
  }
  const result = appendOwnerDecision(args.filePath, {
    sku: args.sku,
    owner_decision: args.owner_decision,
    owner_role_override: args.owner_role_override,
    owner_policy_override: args.owner_policy_override,
    reason: args.reason,
    decided_at: args.decided_at,
    decided_by: args.decided_by,
    status: args.status,
    source_version: args.source_version,
  }, { currentDate: dependencies.currentDate });
  output(
    `Owner decision сохранено: ${result.decision.sku} / ` +
    `${result.decision.owner_decision} / ${result.decision.status}. ` +
    `Записей в истории: ${result.store.decisions.length}.`
  );
  return { mode: 'written', status: 'success', ...result };
}

function main() {
  try {
    runOwnerDecisionCli(process.argv.slice(2));
  } catch (error) {
    console.error(`Ошибка owner decision: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEFAULT_OWNER_DECISIONS_PATH,
  DEFAULT_SOURCE_VERSION,
  OwnerDecisionCliError,
  parseArguments,
  helpText,
  runOwnerDecisionCli,
  main,
};

if (require.main === module) main();
