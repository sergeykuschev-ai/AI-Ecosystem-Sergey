'use strict';

const tls = require('node:tls');

function headerValue(value) {
  return String(value).replace(/[\r\n]+/g, ' ').trim();
}

function buildExcelMessage(options) {
  const boundary = `minmax-${options.marker.replace(/[^A-Za-z0-9]/g, '')}`;
  const fileName = headerValue(options.fileName || 'minmax-e2e.xlsx');
  const lines = [
    `From: <${headerValue(options.from)}>`,
    `To: <${headerValue(options.to)}>`,
    `Subject: ${headerValue(options.subject)}`,
    `Message-ID: <${headerValue(options.marker)}@codex-minmax-e2e>`,
    `Date: ${new Date(options.date || Date.now()).toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    `Automated MinMax production check ${options.marker}.`,
    `--${boundary}`,
    'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Transfer-Encoding: base64',
    `Content-Disposition: attachment; filename="${fileName}"`,
    '',
  ];
  const encoded = Buffer.from(options.file).toString('base64');
  for (let index = 0; index < encoded.length; index += 76) {
    lines.push(encoded.slice(index, index + 76));
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

function connectTls(options, dependencies = {}) {
  const connect = dependencies.connect || tls.connect;
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: options.host,
      port: options.port,
      servername: options.host,
      rejectUnauthorized: options.rejectUnauthorized !== false,
    });
    const onError = error => {
      socket.removeListener('secureConnect', onConnect);
      reject(error);
    };
    const onConnect = () => {
      socket.removeListener('error', onError);
      socket.setTimeout(options.timeoutMs || 30000, () => {
        socket.destroy(new Error('Mail server response timed out.'));
      });
      resolve(socket);
    };
    socket.once('error', onError);
    socket.once('secureConnect', onConnect);
  });
}

function readUntil(socket, complete) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const onData = chunk => {
      chunks.push(Buffer.from(chunk));
      const value = Buffer.concat(chunks);
      if (!complete(value)) return;
      cleanup();
      resolve(value);
    };
    const onError = error => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      reject(new Error('Mail server closed the connection unexpectedly.'));
    };
    const cleanup = () => {
      socket.removeListener('data', onData);
      socket.removeListener('error', onError);
      socket.removeListener('close', onClose);
    };
    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
  });
}

async function smtpResponse(socket) {
  const value = await readUntil(socket, buffer =>
    /(?:^|\r\n)\d{3} [^\r\n]*\r\n$/.test(buffer.toString('utf8'))
  );
  const text = value.toString('utf8');
  const match = text.match(/(?:^|\r\n)(\d{3}) ([^\r\n]*)\r\n$/);
  if (!match) throw new Error(`Invalid SMTP response: ${text.slice(0, 160)}`);
  return { code: Number(match[1]), text };
}

function assertSmtp(response, expected, stage) {
  if (!expected.includes(response.code)) {
    throw new Error(`${stage}: SMTP ${response.code}.`);
  }
}

async function smtpCommand(socket, command, expected, stage) {
  socket.write(`${command}\r\n`);
  const response = await smtpResponse(socket);
  assertSmtp(response, expected, stage);
  return response;
}

async function sendExcelMail(options, dependencies = {}) {
  const socket = await connectTls(options, dependencies);
  try {
    assertSmtp(await smtpResponse(socket), [220], 'greeting');
    await smtpCommand(socket, `EHLO ${options.clientName || 'minmax-production-check'}`, [250], 'EHLO');
    await smtpCommand(socket, 'AUTH LOGIN', [334], 'AUTH LOGIN');
    await smtpCommand(
      socket,
      Buffer.from(options.user).toString('base64'),
      [334],
      'SMTP username'
    );
    await smtpCommand(
      socket,
      Buffer.from(options.password).toString('base64'),
      [235],
      'SMTP password'
    );
    await smtpCommand(socket, `MAIL FROM:<${options.from}>`, [250], 'MAIL FROM');
    await smtpCommand(socket, `RCPT TO:<${options.to}>`, [250, 251], 'RCPT TO');
    await smtpCommand(socket, 'DATA', [354], 'DATA');
    const message = buildExcelMessage(options)
      .replace(/(^|\r\n)\./g, '$1..');
    socket.write(`${message}\r\n.\r\n`);
    assertSmtp(await smtpResponse(socket), [250], 'message acceptance');
    await smtpCommand(socket, 'QUIT', [221], 'QUIT');
    return { accepted: true, marker: options.marker };
  } finally {
    socket.destroy();
  }
}

function quoteImap(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

async function imapCommand(socket, tag, command) {
  socket.write(`${tag} ${command}\r\n`);
  const matcher = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n$`);
  const response = await readUntil(socket, buffer =>
    matcher.test(buffer.toString('latin1'))
  );
  const text = response.toString('latin1');
  const status = text.match(matcher)?.[1];
  if (status !== 'OK') {
    throw new Error(`IMAP ${command.split(' ')[0]} failed with ${status || 'unknown status'}.`);
  }
  return response;
}

function imapSinceDate(value) {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() - 1);
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

async function waitForMailboxText(options, dependencies = {}) {
  const delay = dependencies.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const socket = await connectTls(options, dependencies);
    try {
      const greeting = await readUntil(socket, buffer => /\r\n$/.test(buffer.toString('latin1')));
      if (!/^\* OK/i.test(greeting.toString('latin1'))) {
        throw new Error('IMAP greeting is not OK.');
      }
      await imapCommand(
        socket,
        'A001',
        `LOGIN ${quoteImap(options.user)} ${quoteImap(options.password)}`
      );
      await imapCommand(socket, 'A002', `SELECT ${quoteImap(options.mailbox || 'INBOX')}`);
      const search = await imapCommand(
        socket,
        'A003',
        `UID SEARCH SINCE ${imapSinceDate(options.since)}`
      );
      const searchLine = search.toString('latin1').match(/\* SEARCH([^\r\n]*)/i)?.[1] || '';
      const uids = searchLine.trim().split(/\s+/).filter(value => /^\d+$/.test(value));
      let commandNumber = 4;
      for (const uid of uids.slice(-50).reverse()) {
        const tag = `A${String(commandNumber).padStart(3, '0')}`;
        commandNumber += 1;
        const message = await imapCommand(
          socket,
          tag,
          `UID FETCH ${uid} (BODY.PEEK[])`
        );
        const literal = message.toString('latin1').match(/\{(\d+)\}\r\n/);
        if (!literal) continue;
        const start = literal.index + literal[0].length;
        const raw = message.subarray(start, start + Number(literal[1]));
        if (raw.includes(Buffer.from(options.text, 'utf8')) ||
            raw.toString('latin1').includes(options.text)) {
          const logoutTag = `A${String(commandNumber).padStart(3, '0')}`;
          await imapCommand(socket, logoutTag, 'LOGOUT').catch(() => {});
          return { found: true, uid, raw };
        }
      }
      const logoutTag = `A${String(commandNumber).padStart(3, '0')}`;
      await imapCommand(socket, logoutTag, 'LOGOUT').catch(() => {});
    } finally {
      socket.destroy();
    }
    await delay(Math.min(options.pollIntervalMs || 5000, Math.max(0, deadline - Date.now())));
  }
  throw new Error(`Notification containing ${options.text} was not found in IMAP mailbox.`);
}

module.exports = {
  buildExcelMessage,
  imapSinceDate,
  sendExcelMail,
  waitForMailboxText,
};
