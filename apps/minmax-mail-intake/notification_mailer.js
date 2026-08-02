'use strict';

const tls = require('node:tls');

function cleanHeader(value) {
  return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const onData = chunk => {
      chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString('utf8');
      const match = text.match(/(?:^|\r\n)(\d{3}) [^\r\n]*\r\n$/);
      if (!match) return;
      cleanup();
      resolve({ code: Number(match[1]), text });
    };
    const onError = error => { cleanup(); reject(error); };
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
    };
    socket.on('data', onData);
    socket.once('error', onError);
  });
}

async function command(socket, value, expected, stage) {
  const waiting = readResponse(socket);
  socket.write(`${value}\r\n`);
  const response = await waiting;
  if (!expected.includes(response.code)) {
    const error = new Error(`${stage}: SMTP ${response.code}.`);
    error.code = 'SMTP_COMMAND_FAILED';
    throw error;
  }
}

function connect(config, dependencies = {}) {
  const tlsConnect = dependencies.connect || tls.connect;
  return new Promise((resolve, reject) => {
    const socket = tlsConnect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: true,
    });
    const fail = error => { socket.removeListener('secureConnect', ready); reject(error); };
    const ready = () => {
      socket.removeListener('error', fail);
      socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error('SMTP timeout.')));
      resolve(socket);
    };
    socket.once('error', fail);
    socket.once('secureConnect', ready);
  });
}

async function sendSmtp(config, message, dependencies = {}) {
  const socket = await connect(config, dependencies);
  try {
    const greeting = await readResponse(socket);
    if (greeting.code !== 220) throw new Error(`SMTP greeting: ${greeting.code}.`);
    await command(socket, 'EHLO minmax-direct-mail-intake', [250], 'EHLO');
    await command(socket, 'AUTH LOGIN', [334], 'AUTH LOGIN');
    await command(socket, Buffer.from(config.user).toString('base64'), [334], 'SMTP username');
    await command(socket, Buffer.from(config.password).toString('base64'), [235], 'SMTP password');
    await command(socket, `MAIL FROM:<${cleanHeader(config.from)}>`, [250], 'MAIL FROM');
    await command(socket, `RCPT TO:<${cleanHeader(config.to)}>`, [250, 251], 'RCPT TO');
    await command(socket, 'DATA', [354], 'DATA');
    const body = [
      `From: <${cleanHeader(config.from)}>`,
      `To: <${cleanHeader(config.to)}>`,
      `Subject: =?UTF-8?B?${Buffer.from(message.subject).toString('base64')}?=`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(message.text).toString('base64').replace(/.{1,76}/g, '$&\r\n'),
    ].join('\r\n').replace(/(^|\r\n)\./g, '$1..');
    const accepted = readResponse(socket);
    socket.write(`${body}\r\n.\r\n`);
    const response = await accepted;
    if (response.code !== 250) throw new Error(`SMTP DATA: ${response.code}.`);
    await command(socket, 'QUIT', [221], 'QUIT');
    return { accepted: true };
  } finally {
    socket.destroy();
  }
}

class NotificationMailer {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.send = dependencies.send || ((message) => sendSmtp(config, message, dependencies));
  }

  async sendCompleted(input) {
    const warnings = Array.isArray(input.summary?.warnings) ? input.summary.warnings : [];
    const text = [
      'Отчёт Min/Max обработан AI-закупщиком.',
      '',
      `Статус: completed`,
      `Run: ${input.runId}`,
      `Файл: ${input.filename}`,
      `Предупреждения: ${warnings.length ? warnings.join('; ') : 'нет'}`,
      '',
      `Открыть Owner Review: ${input.ownerReviewUrl}`,
      '',
      'Заказ поставщику автоматически не отправляется.',
    ].join('\n');
    return this.send({
      subject: `Min/Max: отчёт обработан (${input.runId})`,
      text,
    });
  }
}

module.exports = { NotificationMailer, cleanHeader, sendSmtp };
