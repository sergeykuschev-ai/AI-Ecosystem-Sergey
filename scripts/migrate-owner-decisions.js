#!/usr/bin/env node

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const {
  applyOwnerDecisionMigrationPlan,
  buildOwnerDecisionMigrationPlan,
  isRowIdHashKey,
} = require('../agents/purchasing/services/owner_decision_identity');

const REPOSITORY_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DECISIONS_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/miska-owner-decisions.json'
);
const DEFAULT_HISTORY_PATH = path.join(
  REPOSITORY_ROOT,
  'data/purchasing/owner-decision-history.json'
);

function loadJson(filePath) {
  const resolved = path.resolve(filePath);
  const content = fs.readFileSync(resolved, 'utf8');
  return { data: JSON.parse(content), resolved };
}

function countHashKeys(decisions) {
  return decisions.filter(decision => isRowIdHashKey(decision?.sku)).length;
}

function formatSummary(summary) {
  return [
    `Всего решений:      ${summary.total}`,
    `Мигрировано:        ${summary.migrated}`,
    `Без изменений:      ${summary.unchanged}`,
    `Пропущено:          ${summary.skipped}`,
    `Конфликтов:         ${summary.conflicts}`,
  ].join('\n');
}

function printDryRun(plan, summary, hashKeyCount) {
  console.log(`Найдено hash-key решений: ${hashKeyCount}`);
  console.log(formatSummary(summary));

  if (plan.migrated.length > 0) {
    console.log('\nПримеры миграций:');
    for (const migration of plan.migrated.slice(0, 10)) {
      console.log(
        `  ${migration.oldKey}\n` +
        `    -> ${migration.newKey} (${migration.matchMethod})`
      );
    }
    if (plan.migrated.length > 10) {
      console.log(`    ... и ещё ${plan.migrated.length - 10}`);
    }
  }

  if (plan.skipped.length > 0) {
    console.log(`\nПропущено (без истории): ${plan.skipped.length}`);
    for (const skipped of plan.skipped.slice(0, 5)) {
      console.log(`  ${skipped.oldKey}: ${skipped.reason}`);
    }
    if (plan.skipped.length > 5) {
      console.log(`    ... и ещё ${plan.skipped.length - 5}`);
    }
  }

  if (plan.conflicts.length > 0) {
    console.log(`\nКонфликтов: ${plan.conflicts.length}`);
    for (const conflict of plan.conflicts.slice(0, 5)) {
      console.log(`  ${conflict.oldKey}: ${conflict.reason}`);
    }
    if (plan.conflicts.length > 5) {
      console.log(`    ... и ещё ${plan.conflicts.length - 5}`);
    }
  }
}

function runMigration({ decisionsPath, historyPath, apply }) {
  const { data: decisionsMemory, resolved: resolvedDecisionsPath } = loadJson(decisionsPath);
  const { data: decisionHistory } = loadJson(historyPath);

  const hashKeyCount = countHashKeys(decisionsMemory.decisions || []);
  if (hashKeyCount === 0) {
    console.log('Hash-key решений не найдено. Нечего мигрировать.');
    return {
      dryRun: true,
      hashKeyCount: 0,
      applied: false,
      summary: { migrated: 0, unchanged: 0, skipped: 0, conflicts: 0, total: 0 },
    };
  }

  const plan = buildOwnerDecisionMigrationPlan(decisionsMemory, decisionHistory);
  const summary = {
    migrated: plan.migrated.length,
    unchanged: plan.unchanged.length,
    skipped: plan.skipped.length,
    conflicts: plan.conflicts.length,
    total: plan.migrated.length + plan.unchanged.length + plan.skipped.length + plan.conflicts.length,
  };

  if (!apply) {
    printDryRun(plan, summary, hashKeyCount);
    console.log('\nДля применения миграции запустите с --apply.');
    return { dryRun: true, hashKeyCount, applied: false, summary, plan };
  }

  const migrationResult = applyOwnerDecisionMigrationPlan(plan, {
    dryRun: false,
    decisionsMemory,
  });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${resolvedDecisionsPath}.pre-migration-backup-${timestamp}.json`;
  fs.copyFileSync(resolvedDecisionsPath, backupPath);

  const directory = path.dirname(resolvedDecisionsPath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${path.basename(resolvedDecisionsPath)}.${process.pid}.tmp`
  );
  try {
    fs.writeFileSync(
      temporaryPath,
      `${JSON.stringify(migrationResult.decisionsMemory, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' }
    );
    fs.renameSync(temporaryPath, resolvedDecisionsPath);
  } catch (error) {
    try {
      if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
    } catch {}
    throw error;
  }

  console.log('Миграция применена.');
  console.log(formatSummary(summary));
  console.log(`Резервная копия: ${backupPath}`);

  return {
    dryRun: false,
    hashKeyCount,
    applied: true,
    summary,
    plan,
    backupPath,
  };
}

function parseArguments(argv) {
  const parsed = {
    decisionsPath: DEFAULT_DECISIONS_PATH,
    historyPath: DEFAULT_HISTORY_PATH,
    apply: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      parsed.apply = true;
    } else if (argument === '--decisions') {
      const value = argv[index + 1];
      if (!value) throw new Error(`Для ${argument} требуется значение.`);
      parsed.decisionsPath = value;
      index += 1;
    } else if (argument === '--history') {
      const value = argv[index + 1];
      if (!value) throw new Error(`Для ${argument} требуется значение.`);
      parsed.historyPath = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      console.log([
        'Миграция legacy SMARTZAPAS hash-key решений владельца в канонические ключи.',
        '',
        'Использование:',
        '  node scripts/migrate-owner-decisions.js [--apply] [--decisions <путь>] [--history <путь>]',
        '',
        'По умолчанию читает data/purchasing/miska-owner-decisions.json и',
        'data/purchasing/owner-decision-history.json.',
        '',
        '  --apply       Применить миграцию (с резервной копией и атомарной записью).',
        '  --decisions   Путь к файлу решений владельца.',
        '  --history     Путь к файлу истории решений.',
      ].join('\n'));
      process.exit(0);
    } else {
      throw new Error(`Неизвестный аргумент: ${argument}. Используйте --help.`);
    }
  }
  return parsed;
}

function main() {
  try {
    const args = parseArguments(process.argv.slice(2));
    runMigration(args);
  } catch (error) {
    console.error(`Ошибка миграции: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  runMigration,
  parseArguments,
};

if (require.main === module) main();
