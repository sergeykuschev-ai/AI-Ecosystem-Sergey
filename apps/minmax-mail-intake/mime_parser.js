'use strict';

function headerBody(buffer) {
  const crlf = buffer.indexOf(Buffer.from('\r\n\r\n'));
  const lf = crlf === -1 ? buffer.indexOf(Buffer.from('\n\n')) : -1;
  const index = crlf === -1 ? lf : crlf;
  const width = crlf === -1 ? 2 : 4;
  if (index === -1) return { header: buffer, body: Buffer.alloc(0) };
  return { header: buffer.subarray(0, index), body: buffer.subarray(index + width) };
}

function decodeQuotedPrintable(buffer) {
  const text = buffer.toString('latin1').replace(/=\r?\n/g, '');
  const bytes = [];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '=' && /^[0-9A-Fa-f]{2}$/.test(text.slice(index + 1, index + 3))) {
      bytes.push(Number.parseInt(text.slice(index + 1, index + 3), 16));
      index += 2;
    } else {
      bytes.push(text.charCodeAt(index) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

function unfoldHeaderValue(value) {
  return String(value || '').replace(/\r?\n[ \t]+/g, ' ');
}

function decodeRawUtf8(value) {
  const bytes = Buffer.from(String(value || ''), 'latin1');
  const decoded = bytes.toString('utf8');
  return decoded.includes('\ufffd') ? String(value || '') : decoded;
}

function decodeEncodedWords(value) {
  const unfolded = unfoldHeaderValue(value);
  const source = unfolded.includes('=?') ? unfolded : decodeRawUtf8(unfolded);
  return source.replace(/(\?=)[ \t]+(?==\?)/g, '$1').replace(
    /=\?([^?]+)\?([bqBQ])\?([^?]*)\?=/g,
    (_match, charset, encoding, content) => {
      let bytes;
      if (encoding.toLowerCase() === 'b') {
        bytes = Buffer.from(content, 'base64');
      } else {
        bytes = decodeQuotedPrintable(Buffer.from(content.replace(/_/g, ' '), 'latin1'));
      }
      const normalized = String(charset).toLowerCase();
      return bytes.toString(normalized === 'iso-8859-1' ? 'latin1' : 'utf8');
    }
  );
}

function normalizeHeaderText(value) {
  return unfoldHeaderValue(value).normalize('NFC').replace(/\s+/gu, ' ').trim();
}

function normalizeEmailAddress(value) {
  const decoded = normalizeHeaderText(decodeEncodedWords(value));
  const angleAddress = decoded.match(/<\s*([^<>]+?)\s*>/)?.[1] || '';
  const source = angleAddress || decoded;
  const email = source.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+/i)?.[0];
  return String(email || source).replace(/^mailto:/i, '').trim().toLowerCase();
}

function parseHeaders(buffer) {
  const lines = buffer.toString('latin1').split(/\r?\n/);
  const unfolded = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line) && unfolded.length) {
      unfolded[unfolded.length - 1] += ` ${line.trim()}`;
    } else {
      unfolded.push(line);
    }
  }
  const headers = {};
  for (const line of unfolded) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return headers;
}

function splitParameters(value) {
  const parts = [];
  let current = '';
  let quoted = false;
  for (const character of String(value || '')) {
    if (character === '"') quoted = !quoted;
    if (character === ';' && !quoted) {
      parts.push(current.trim());
      current = '';
    } else {
      current += character;
    }
  }
  parts.push(current.trim());
  return parts;
}

function parseStructuredHeader(value) {
  const parts = splitParameters(value);
  const parameters = {};
  for (const part of parts.slice(1)) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    const name = part.slice(0, separator).trim().toLowerCase();
    let parameter = part.slice(separator + 1).trim().replace(/^"|"$/g, '');
    if (name.endsWith('*')) {
      const encoded = parameter.match(/^[^']*'[^']*'(.*)$/)?.[1] || parameter;
      try { parameter = decodeURIComponent(encoded); } catch {}
    }
    parameters[name.replace(/\*$/, '')] = decodeEncodedWords(parameter);
  }
  return { value: String(parts[0] || '').toLowerCase(), parameters };
}

function multipartParts(body, boundary) {
  const marker = Buffer.from(`--${boundary}`, 'latin1');
  const positions = [];
  let offset = 0;
  while (offset < body.length) {
    const position = body.indexOf(marker, offset);
    if (position === -1) break;
    const lineStart = position === 0 || body[position - 1] === 0x0a;
    const after = body.subarray(position + marker.length, position + marker.length + 2);
    if (lineStart && (after[0] === 0x0d || after[0] === 0x0a ||
        (after[0] === 0x2d && after[1] === 0x2d))) {
      positions.push(position);
    }
    offset = position + marker.length;
  }
  const parts = [];
  for (let index = 0; index < positions.length - 1; index += 1) {
    let start = positions[index] + marker.length;
    const suffix = body.subarray(start, start + 2).toString('latin1');
    if (suffix === '--') break;
    if (suffix === '\r\n') start += 2;
    else if (suffix.startsWith('\n')) start += 1;
    let end = positions[index + 1];
    if (end >= 2 && body.subarray(end - 2, end).toString('latin1') === '\r\n') end -= 2;
    else if (end >= 1 && body[end - 1] === 0x0a) end -= 1;
    parts.push(body.subarray(start, end));
  }
  return parts;
}

function decodePartBody(body, transferEncoding) {
  const encoding = String(transferEncoding || '').toLowerCase();
  if (encoding === 'base64') {
    return Buffer.from(body.toString('ascii').replace(/\s+/g, ''), 'base64');
  }
  if (encoding === 'quoted-printable') return decodeQuotedPrintable(body);
  return Buffer.from(body);
}

function collectParts(entity, output) {
  const { header, body } = headerBody(entity);
  const headers = parseHeaders(header);
  const contentType = parseStructuredHeader(headers['content-type'] || 'text/plain');
  if (contentType.value.startsWith('multipart/')) {
    const boundary = contentType.parameters.boundary;
    if (!boundary) throw new Error('MIME multipart boundary is missing.');
    for (const part of multipartParts(body, boundary)) collectParts(part, output);
    return;
  }
  const disposition = parseStructuredHeader(headers['content-disposition'] || '');
  const filename = disposition.parameters.filename || contentType.parameters.name || null;
  if (filename || disposition.value === 'attachment') {
    output.push({
      filename: filename || 'attachment.bin',
      contentType: contentType.value,
      content: decodePartBody(body, headers['content-transfer-encoding']),
    });
  }
}

function parseMimeMessage(input) {
  const raw = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const { header } = headerBody(raw);
  const headers = parseHeaders(header);
  const attachments = [];
  collectParts(raw, attachments);
  const from = normalizeHeaderText(decodeEncodedWords(headers.from || ''));
  const subject = normalizeHeaderText(decodeEncodedWords(headers.subject || ''));
  return {
    from,
    sender: normalizeEmailAddress(from),
    subject,
    date: headers.date || null,
    messageId: headers['message-id'] || null,
    attachments,
  };
}

module.exports = {
  decodeEncodedWords,
  decodeQuotedPrintable,
  multipartParts,
  normalizeEmailAddress,
  normalizeHeaderText,
  parseHeaders,
  parseMimeMessage,
  parseStructuredHeader,
  unfoldHeaderValue,
};
