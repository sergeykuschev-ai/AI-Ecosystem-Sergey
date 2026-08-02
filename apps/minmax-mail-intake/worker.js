'use strict';

const crypto = require('node:crypto');

const {
  normalizeEmailAddress,
  normalizeHeaderText,
  parseMimeMessage,
} = require('./mime_parser');

function sanitizeKeyPart(value) {
  return String(value ?? '')
    .replace(/[^A-Za-z0-9._:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 100) || 'na';
}

function sha256(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function buildEventId(mailbox, messageUid, raw) {
  const digest = crypto.createHash('sha256')
    .update(String(mailbox))
    .update('\0')
    .update(String(messageUid))
    .update('\0')
    .update(raw)
    .digest('hex');
  return `minmax-event-${digest.slice(0, 32)}`;
}

function buildIdempotencyKey(input) {
  return [
    'minmax',
    sanitizeKeyPart(input.mailbox),
    sanitizeKeyPart(input.messageUid),
    sanitizeKeyPart(input.attachmentName),
    String(input.attachmentSize),
    input.sha256,
  ].join('-').slice(0, 512);
}

function senderAddress(value) {
  return normalizeEmailAddress(value);
}

function filterDiagnostics(message, config) {
  const normalizedSender = normalizeEmailAddress(message.from || message.sender);
  const expectedSender = normalizeEmailAddress(config.allowedSender);
  const normalizedSubject = normalizeHeaderText(message.subject).slice(0, 500);
  const expectedSubjectPattern = normalizeHeaderText(config.subjectPattern).slice(0, 500);
  const correlationMarker = normalizedSubject.match(
    /\bminmax-direct-e2e-\d+-[a-z0-9]+\b/i
  )?.[0]?.toLowerCase() || null;
  return {
    normalizedSender,
    expectedSender,
    normalizedSubject,
    expectedSubjectPattern,
    markerPresent: Boolean(correlationMarker),
    correlationMarker,
  };
}

function excelSignature(content, filename) {
  const lower = String(filename).toLowerCase();
  if (lower.endsWith('.xlsx')) {
    return content.length >= 4 && content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  }
  if (lower.endsWith('.xls')) {
    return content.length >= 8 && content.subarray(0, 8).equals(
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    );
  }
  return false;
}

function evaluateMessage(message, config) {
  const diagnostics = filterDiagnostics(message, config);
  const reasonCodes = [];
  if (diagnostics.normalizedSender !== diagnostics.expectedSender) {
    reasonCodes.push('SENDER_NOT_ALLOWED');
  }
  if (!diagnostics.normalizedSubject.toLowerCase().includes(
    diagnostics.expectedSubjectPattern.toLowerCase()
  )) {
    reasonCodes.push('SUBJECT_MISMATCH');
  }
  if (reasonCodes.length) {
    return {
      outcome: 'ignored',
      reasonCode: reasonCodes[0],
      reasonCodes,
      diagnostics,
    };
  }
  if (message.attachments.length === 0) {
    return { outcome: 'rejected', reasonCode: 'NO_ATTACHMENT', diagnostics };
  }
  if (message.attachments.length !== 1) {
    return { outcome: 'rejected', reasonCode: 'MULTIPLE_ATTACHMENTS', diagnostics };
  }
  const attachment = message.attachments[0];
  const lower = attachment.filename.toLowerCase();
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    return {
      outcome: 'rejected', reasonCode: 'ATTACHMENT_TYPE_UNSUPPORTED', attachment, diagnostics,
    };
  }
  if (attachment.content.length > config.maxAttachmentBytes) {
    return { outcome: 'rejected', reasonCode: 'ATTACHMENT_TOO_LARGE', attachment, diagnostics };
  }
  if (!excelSignature(attachment.content, attachment.filename)) {
    return {
      outcome: 'rejected', reasonCode: 'ATTACHMENT_SIGNATURE_INVALID', attachment, diagnostics,
    };
  }
  return { outcome: 'process', reasonCode: null, attachment, diagnostics };
}

function safeError(error) {
  return {
    code: String(error?.code || 'UNEXPECTED_ERROR').slice(0, 128),
    message: String(error?.message || error || 'Unknown error')
      .replace(/(password|token|secret)=?[^\s]*/gi, '$1=[REDACTED]')
      .slice(0, 500),
  };
}

class MinmaxMailWorker {
  constructor(options) {
    this.config = options.config;
    this.imapClient = options.imapClient;
    this.purchasingClient = options.purchasingClient;
    this.mailer = options.mailer;
    this.logger = options.logger || console;
    this.delay = options.delay || (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.parseMime = options.parseMime || parseMimeMessage;
    this.state = options.state;
    this.running = false;
    this.stopping = false;
    this.handledUids = new Set();
    this.stopSignal = new Promise(resolve => { this.resolveStop = resolve; });
  }

  log(level, payload) {
    const record = JSON.stringify({
      timestamp: new Date().toISOString(),
      service: 'minmax-direct-mail-intake',
      ...payload,
    });
    const method = typeof this.logger[level] === 'function' ? level : 'log';
    this.logger[method](record);
  }

  recordEvent(event) {
    this.state.lastEvent = event;
    if (!Array.isArray(this.state.recentEvents)) this.state.recentEvents = [];
    this.state.recentEvents.push(event);
    if (this.state.recentEvents.length > 200) {
      this.state.recentEvents.splice(0, this.state.recentEvents.length - 200);
    }
  }

  async notifyOnce(record, context) {
    if (record?.notification_sent_at) return { sent: false, suppressed: true };
    await this.mailer.sendCompleted(context);
    await this.purchasingClient.markNotification(context.idempotencyKey);
    return { sent: true, suppressed: false };
  }

  async completeExisting(record, context) {
    const runId = record.run_id;
    const status = await this.purchasingClient.waitForRun(runId);
    const artifact = await this.purchasingClient.verifySourceArtifact(
      runId,
      context.sha256,
      context.filename
    );
    const summary = await this.purchasingClient.runSummary(runId);
    const ownerReviewUrl = `${this.config.ownerUiBaseUrl}/?runId=${encodeURIComponent(runId)}`;
    const notification = await this.notifyOnce(record, {
      ...context,
      runId,
      summary,
      ownerReviewUrl,
    });
    return { runId, status, artifact, summary, ownerReviewUrl, notification, replay: true };
  }

  async processFetchedMessage(fetched) {
    const eventId = buildEventId(this.config.imap.mailbox, fetched.uid, fetched.raw);
    const baseEvent = {
      eventId,
      mailbox: this.config.imap.mailbox,
      messageUid: String(fetched.uid),
      startedAt: new Date().toISOString(),
    };
    this.state.lastEvent = baseEvent;
    let correlationMarker = null;
    try {
      const message = this.parseMime(fetched.raw);
      const decision = evaluateMessage(message, this.config);
      correlationMarker = decision.diagnostics?.correlationMarker || null;
      if (decision.outcome === 'ignored') {
        this.handledUids.add(String(fetched.uid));
        const event = {
          ...baseEvent,
          status: 'ignored',
          reasonCode: decision.reasonCode,
          reasonCodes: decision.reasonCodes,
          ...decision.diagnostics,
        };
        this.recordEvent(event);
        this.log('log', event);
        return event;
      }
      const attachment = decision.attachment;
      const attachmentName = attachment?.filename || 'no-attachment';
      const content = attachment?.content || Buffer.alloc(0);
      const contentSha = sha256(content);
      const context = {
        idempotencyKey: buildIdempotencyKey({
          mailbox: this.config.imap.mailbox,
          messageUid: fetched.uid,
          attachmentName,
          attachmentSize: content.length,
          sha256: contentSha,
        }),
        mailbox: this.config.imap.mailbox,
        messageUid: String(fetched.uid),
        filename: attachmentName,
        contentType: attachment?.contentType || 'application/octet-stream',
        content,
        sha256: contentSha,
      };
      if (decision.outcome === 'rejected') {
        await this.purchasingClient.registerFiltered({
          ...context,
          attachmentName,
          attachmentSize: content.length,
          state: 'rejected',
          errorCode: decision.reasonCode,
        });
        const event = {
          ...baseEvent,
          correlationMarker,
          idempotencyKey: context.idempotencyKey,
          status: 'rejected',
          reasonCode: decision.reasonCode,
        };
        this.recordEvent(event);
        this.handledUids.add(String(fetched.uid));
        this.log('warn', event);
        return event;
      }
      this.recordEvent({
        ...baseEvent,
        correlationMarker,
        status: 'processing',
        processingStage: 'wait_service_event',
      });
      const existing = await this.purchasingClient.registryRecord(context.idempotencyKey);
      let result;
      if (existing?.run_id) {
        this.recordEvent({
          ...baseEvent,
          correlationMarker,
          idempotencyKey: context.idempotencyKey,
          status: 'processing',
          processingStage: 'wait_run',
          runId: existing.run_id,
          replay: true,
        });
        result = await this.completeExisting(existing, context);
      } else {
        const uploaded = await this.purchasingClient.upload(context);
        this.recordEvent({
          ...baseEvent,
          correlationMarker,
          idempotencyKey: context.idempotencyKey,
          status: 'processing',
          processingStage: 'wait_run',
          runId: uploaded.runId,
          replay: uploaded.replay === true,
        });
        const status = await this.purchasingClient.waitForRun(uploaded.runId);
        const artifact = await this.purchasingClient.verifySourceArtifact(
          uploaded.runId,
          context.sha256,
          context.filename
        );
        const summary = await this.purchasingClient.runSummary(uploaded.runId);
        const ownerReviewUrl = `${this.config.ownerUiBaseUrl}/?runId=${encodeURIComponent(uploaded.runId)}`;
        const current = await this.purchasingClient.registryRecord(context.idempotencyKey);
        const notification = await this.notifyOnce(current, {
          ...context,
          runId: uploaded.runId,
          summary,
          ownerReviewUrl,
        });
        result = { ...uploaded, status, artifact, summary, ownerReviewUrl, notification };
      }
      const event = {
        ...baseEvent,
        correlationMarker,
        idempotencyKey: context.idempotencyKey,
        attachmentName,
        status: 'completed',
        runId: result.runId,
        replay: result.replay === true,
        notificationSent: result.notification.sent,
        notificationSuppressed: result.notification.suppressed,
        sourceArtifactSha256: result.artifact.downloadedSha256,
        ownerReviewUrl: result.ownerReviewUrl,
        completedAt: new Date().toISOString(),
      };
      this.state.lastProcessedUid = String(fetched.uid);
      this.state.lastSuccessfulRunId = result.runId;
      this.state.lastError = null;
      this.recordEvent(event);
      this.state.eventCount += 1;
      this.handledUids.add(String(fetched.uid));
      this.log('log', event);
      return event;
    } catch (error) {
      const safe = safeError(error);
      const event = {
        ...baseEvent,
        correlationMarker,
        status: 'failed',
        error: safe,
      };
      this.state.lastError = safe;
      this.recordEvent(event);
      this.state.eventCount += 1;
      this.log('error', event);
      throw error;
    }
  }

  async pollOnce() {
    this.state.lastPollAt = new Date().toISOString();
    const messages = await this.imapClient.fetchRecent();
    this.state.imapConnected = true;
    const unique = new Map(messages.map(message => [String(message.uid), message]));
    const results = [];
    for (const [uid, message] of unique) {
      if (this.handledUids.has(uid)) continue;
      results.push(await this.processFetchedMessage(message));
    }
    return results;
  }

  async run() {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    while (!this.stopping) {
      try {
        await this.pollOnce();
      } catch (error) {
        this.state.imapConnected = false;
        this.state.lastError = safeError(error);
        if (!this.stopping) {
          await Promise.race([
            this.delay(this.config.reconnectBackoffMs),
            this.stopSignal,
          ]);
        }
      }
      if (!this.stopping) {
        await Promise.race([
          this.delay(this.config.imap.pollIntervalMs),
          this.stopSignal,
        ]);
      }
    }
    this.running = false;
  }

  stop() {
    this.stopping = true;
    this.resolveStop();
  }
}

module.exports = {
  MinmaxMailWorker,
  buildEventId,
  buildIdempotencyKey,
  evaluateMessage,
  excelSignature,
  filterDiagnostics,
  safeError,
  sanitizeKeyPart,
  senderAddress,
  sha256,
};
