'use strict';

const tls = require('node:tls');

function quote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function sinceDate(hours, now = Date.now()) {
  const date = new Date(now - (hours * 60 * 60 * 1000));
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getUTCDate()}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
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
    const onError = error => { cleanup(); reject(error); };
    const onClose = () => { cleanup(); reject(new Error('IMAP connection closed.')); };
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

async function command(socket, tag, value) {
  const pattern = new RegExp(`(?:^|\\r\\n)${tag} (OK|NO|BAD)[^\\r\\n]*\\r\\n$`);
  const waiting = readUntil(socket, buffer => pattern.test(buffer.toString('latin1')));
  socket.write(`${tag} ${value}\r\n`);
  const response = await waiting;
  const status = response.toString('latin1').match(pattern)?.[1];
  if (status !== 'OK') {
    const error = new Error(`IMAP ${value.split(' ')[0]} failed: ${status || 'MALFORMED'}.`);
    error.code = 'IMAP_COMMAND_FAILED';
    throw error;
  }
  return response;
}

function parseSearch(response) {
  const line = response.toString('latin1').match(/(?:^|\r\n)\* SEARCH([^\r\n]*)/i)?.[1] || '';
  return [...new Set(line.trim().split(/\s+/).filter(value => /^\d+$/.test(value)))];
}

function extractFetchedMessage(response, expectedUid) {
  const text = response.toString('latin1');
  const uid = text.match(/\bUID\s+(\d+)\b/i)?.[1] || String(expectedUid);
  const literal = text.match(/\{(\d+)\}\r\n/);
  if (!literal) throw new Error(`IMAP FETCH ${expectedUid} did not contain a literal.`);
  const start = literal.index + literal[0].length;
  const length = Number(literal[1]);
  const raw = response.subarray(start, start + length);
  if (raw.length !== length) throw new Error(`IMAP FETCH ${expectedUid} literal is truncated.`);
  return { uid, raw };
}

function connectTls(config, dependencies = {}) {
  const connect = dependencies.connect || tls.connect;
  return new Promise((resolve, reject) => {
    const socket = connect({
      host: config.host,
      port: config.port,
      servername: config.host,
      rejectUnauthorized: true,
    });
    const fail = error => { socket.removeListener('secureConnect', ready); reject(error); };
    const ready = () => {
      socket.removeListener('error', fail);
      socket.setTimeout(config.timeoutMs, () => socket.destroy(new Error('IMAP timeout.')));
      resolve(socket);
    };
    socket.once('error', fail);
    socket.once('secureConnect', ready);
  });
}

class ImapClient {
  constructor(config, dependencies = {}) {
    this.config = config;
    this.connect = dependencies.connect || (value => connectTls(value, dependencies));
    this.command = dependencies.command || command;
    this.readUntil = dependencies.readUntil || readUntil;
  }

  async fetchRecent() {
    const socket = await this.connect(this.config);
    try {
      const greeting = await this.readUntil(socket, buffer => /\r\n$/.test(buffer.toString('latin1')));
      if (!/^\* OK/i.test(greeting.toString('latin1'))) {
        throw new Error('IMAP greeting is malformed.');
      }
      await this.command(socket, 'A001', `LOGIN ${quote(this.config.user)} ${quote(this.config.password)}`);
      await this.command(socket, 'A002', `SELECT ${quote(this.config.mailbox)}`);
      const searched = await this.command(
        socket,
        'A003',
        `UID SEARCH SINCE ${sinceDate(this.config.recentWindowHours)}`
      );
      const uids = parseSearch(searched).slice(-this.config.maxMessages);
      const messages = [];
      let sequence = 4;
      for (const uid of uids) {
        const tag = `A${String(sequence).padStart(3, '0')}`;
        sequence += 1;
        const fetched = await this.command(socket, tag, `UID FETCH ${uid} (UID BODY.PEEK[])`);
        messages.push(extractFetchedMessage(fetched, uid));
      }
      const logout = `A${String(sequence).padStart(3, '0')}`;
      await this.command(socket, logout, 'LOGOUT').catch(() => {});
      return messages;
    } finally {
      socket.destroy();
    }
  }
}

module.exports = {
  ImapClient,
  command,
  connectTls,
  extractFetchedMessage,
  parseSearch,
  quote,
  readUntil,
  sinceDate,
};
