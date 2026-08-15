'use strict';

const fs = require('node:fs');

const { createMailSkill } = require('./mail_skill');
const { createMailboxRegistry } = require('./mailbox_registry');
const { createIMAPAdapter } = require('./providers/imap_adapter');

function mailConfigError(field) {
  const error = new Error(`Yandex mail configuration is invalid: ${field}`);
  error.name = 'MailConfigError';
  error.code = 'MAIL_CONFIG_INVALID';
  return error;
}

function requireConfigString(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw mailConfigError(field);
  return value.trim();
}

function readSecretFile(filePath, field, fileSystem = fs) {
  const normalizedPath = requireConfigString(filePath, field);
  let stat;
  try {
    stat = fileSystem.statSync(normalizedPath);
  } catch {
    throw mailConfigError(`${field} file is unavailable`);
  }
  if (!stat.isFile()) throw mailConfigError(`${field} path must be a file`);

  let value;
  try {
    value = fileSystem.readFileSync(normalizedPath, 'utf8').trim();
  } catch {
    throw mailConfigError(`${field} file is unreadable`);
  }
  if (!value || value.startsWith('replace-with-')) {
    throw mailConfigError(`${field} file is empty or still contains a placeholder`);
  }
  return value;
}

function createYandexMailSkillFromConfig(config = {}, dependencies = {}) {
  if (config.enabled !== true) return null;
  const provider = requireConfigString(config.provider, 'provider');
  if (provider !== 'yandex') throw mailConfigError('provider must be yandex');
  if (config.tls !== true) throw mailConfigError('TLS must be enabled');

  const fileSystem = dependencies.fileSystem || fs;
  const username = readSecretFile(config.usernameSecretFile, 'username secret', fileSystem);
  const password = readSecretFile(config.appPasswordSecretFile, 'app password secret', fileSystem);
  const createAdapter = dependencies.createAdapter || createIMAPAdapter;
  const mailbox = {
    mailboxId: requireConfigString(config.mailboxId, 'mailboxId'),
    provider,
    accountType: requireConfigString(config.accountType, 'accountType'),
    businessContext: requireConfigString(config.businessContext, 'businessContext'),
    displayName: requireConfigString(config.displayName, 'displayName'),
  };
  const adapter = createAdapter({
    provider,
    host: requireConfigString(config.host, 'IMAP host'),
    port: config.port,
    secure: true,
    folder: requireConfigString(config.folder, 'IMAP folder'),
    username,
    password,
    connectionTimeoutMs: config.connectionTimeoutMs,
    socketTimeoutMs: config.socketTimeoutMs,
    maxMessageBytes: config.maxMessageBytes,
    clientFactory: dependencies.clientFactory,
    parseMessage: dependencies.parseMessage,
  });

  return createMailSkill({
    mailboxRegistry: createMailboxRegistry([mailbox]),
    adapters: { [provider]: adapter },
  });
}

module.exports = {
  createYandexMailSkillFromConfig,
  mailConfigError,
  readSecretFile,
};
