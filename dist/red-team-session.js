import { AegisPolicyEngine, DEFAULT_POLICY, RULES } from './policy-engine.js';

export const RED_TEAM_START = '2026-08-02T10:00:00.000Z';
export const MAX_SIMULATED_INR = 10_000_000;
const EMPTY_RUNTIME = Object.freeze({ taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 });

export const RED_TEAM_PRESETS = Object.freeze({
  compliant: Object.freeze({ label: 'Policy-Compliant Payment', amount: '1200.00', requestCount: 1, intervalSeconds: 0, nonceMode: 'fresh', versionMode: 'current', taskMode: 'correct', recipientMode: 'approved', settlementMode: 'settle', agentMode: 'normal', attemptType: 'single' }),
  oversized: Object.freeze({ label: 'Oversized Payment', amount: '8500.00', requestCount: 1, intervalSeconds: 0, nonceMode: 'fresh', versionMode: 'current', taskMode: 'correct', recipientMode: 'approved', settlementMode: 'settle', agentMode: 'overzealous', attemptType: 'single' }),
  unknown: Object.freeze({ label: 'Unknown Recipient', amount: '1200.00', requestCount: 1, intervalSeconds: 0, nonceMode: 'fresh', versionMode: 'current', taskMode: 'correct', recipientMode: 'custom', customRecipient: 'Unknown Counterparty', settlementMode: 'settle', agentMode: 'compromised', attemptType: 'single' }),
  wrongTask: Object.freeze({ label: 'Wrong Task', amount: '1200.00', requestCount: 1, intervalSeconds: 0, nonceMode: 'fresh', versionMode: 'current', taskMode: 'incorrect', recipientMode: 'approved', settlementMode: 'settle', agentMode: 'overzealous', attemptType: 'single' }),
  splitting: Object.freeze({ label: 'Threshold Splitting', amount: '1999.00', requestCount: 4, intervalSeconds: 11 / 3, nonceMode: 'fresh', versionMode: 'current', taskMode: 'correct', recipientMode: 'approved', settlementMode: 'settle', agentMode: 'compromised', attemptType: 'coordinated' }),
  rapid: Object.freeze({ label: 'Rapid-Fire Spending', amount: '500.00', requestCount: 8, intervalSeconds: 0, nonceMode: 'fresh', versionMode: 'current', taskMode: 'correct', recipientMode: 'approved', settlementMode: 'settle', agentMode: 'overzealous', attemptType: 'coordinated' }),
  duplicate: Object.freeze({ label: 'Duplicate Nonce', amount: '600.00', requestCount: 2, intervalSeconds: 1, nonceMode: 'replay', versionMode: 'current', taskMode: 'correct', recipientMode: 'approved', settlementMode: 'settle', agentMode: 'compromised', attemptType: 'coordinated' }),
  stale: Object.freeze({ label: 'Stale Policy Version', amount: '1200.00', requestCount: 1, intervalSeconds: 0, nonceMode: 'fresh', versionMode: 'stale', taskMode: 'correct', recipientMode: 'approved', settlementMode: 'settle', agentMode: 'overzealous', attemptType: 'single' }),
  pending: Object.freeze({ label: 'Pending Payment + Kill Switch', amount: '1500.00', requestCount: 1, intervalSeconds: 0, nonceMode: 'fresh', versionMode: 'current', taskMode: 'correct', recipientMode: 'approved', settlementMode: 'pending', agentMode: 'normal', attemptType: 'single' }),
});

export function parseAmountToPaise(value, field = 'Amount') {
  const raw = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new TypeError(`${field} must be a positive INR amount with no more than two decimal places.`);
  const [whole, fraction = ''] = raw.split('.');
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(paise) || paise <= 0) throw new RangeError(`${field} must be greater than ₹0.`);
  if (paise > MAX_SIMULATED_INR * 100) throw new RangeError(`${field} exceeds the safe simulated maximum of ₹${MAX_SIMULATED_INR.toLocaleString('en-IN')}.`);
  return paise;
}

export function paiseToAmount(paise) {
  if (!Number.isSafeInteger(paise)) throw new TypeError('Paise value must be a safe integer.');
  return paise / 100;
}

export function formatPaise(paise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 }).format(paiseToAmount(paise));
}

export function validatePlainText(value, field, { maxLength = 80 } = {}) {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!text) throw new TypeError(`${field} is required.`);
  if (text.length > maxLength) throw new RangeError(`${field} must be ${maxLength} characters or fewer.`);
  if (/[<>\u0000-\u001f\u007f]|javascript:|data:text\/html|on\w+\s*=/i.test(text)) throw new TypeError(`${field} must contain plain text only.`);
  return text;
}

export function escapeRedTeamText(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function finiteInRange(value, field, minimum, maximum, { integer = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum || (integer && !Number.isInteger(number))) {
    throw new RangeError(`${field} must be ${integer ? 'an integer ' : ''}between ${minimum} and ${maximum}.`);
  }
  return number;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function addMilliseconds(timestamp, milliseconds) {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

function decisionPriority(result) {
  return ({ INVALIDATE: 6, FREEZE: 5, BLOCK: 4, REQUIRE_APPROVAL: 3, HOLD: 2, APPROVE: 1 }[result?.decision] ?? 0);
}

export function aggregateRedTeamResults(results, context = {}) {
  const list = (Array.isArray(results) ? results : [results]).filter(Boolean);
  const primary = [...list].sort((left, right) => decisionPriority(right) - decisionPriority(left))[0] ?? null;
  const fundsMovedPaise = list.reduce((sum, result) => sum + Math.round(Number(result.fundsMoved ?? 0) * 100), 0);
  return {
    decision: primary?.decision ?? 'ERROR',
    primary,
    results: clone(list),
    ruleChecked: primary?.ruleChecked ?? 'NO_RESULT',
    reason: primary?.reason ?? 'The canonical engine returned no result.',
    rulesEvaluated: clone(primary?.rulesEvaluated ?? []),
    riskState: primary?.riskState ?? 'NORMAL',
    riskScore: primary?.riskScore ?? 0,
    activePolicyVersion: primary?.activePolicyVersion,
    fundsMovedPaise,
    fundsMoved: paiseToAmount(fundsMovedPaise),
    combinedAmountPaise: context.combinedAmountPaise ?? 0,
    requestCount: context.requestCount ?? list.length,
    windowSeconds: context.windowSeconds ?? 0,
    intentIds: list.map(result => result.intent?.id).filter(Boolean),
    ledgerEvents: clone(context.ledgerEvents ?? []),
    settlementDelayMs: Math.max(0, ...list.map(result => Number(result.settlementDelayMs ?? 0))),
    presetLabel: context.presetLabel ?? 'Custom Attempt',
    attempt: clone(context.attempt ?? {}),
  };
}

export class RedTeamSession {
  constructor({ basePolicy = DEFAULT_POLICY, startAt = RED_TEAM_START } = {}) {
    this.sourcePolicy = clone(basePolicy);
    this.startAt = new Date(startAt).toISOString();
    this.reset();
  }

  _nextTimestamp(stepMs = 1_000) {
    const timestamp = new Date(this.logicalTime).toISOString();
    this.logicalTime += stepMs;
    return timestamp;
  }

  _newEngine(policy) {
    return new AegisPolicyEngine({
      policy: clone(policy),
      agents: [{ id: policy.authorisedAgentId }],
      initialRuntime: EMPTY_RUNTIME,
      clock: () => this._nextTimestamp(),
    });
  }

  reset({ policy = this.sourcePolicy } = {}) {
    this.logicalTime = new Date(this.startAt).getTime();
    this.sequence = 0;
    this.lastNonce = null;
    this.lastAttempt = null;
    this.lastOutcome = null;
    this.pending = new Map();
    this.engine = this._newEngine(policy);
    return this.getSnapshot();
  }

  getSnapshot() {
    return { ...this.engine.getSnapshot(), summary: this.getSummary(), lastOutcome: clone(this.lastOutcome) };
  }

  getLedger() {
    return this.engine.getLedger();
  }

  activatePolicy(values) {
    const current = this.engine.getSnapshot().policy;
    const agentId = validatePlainText(values.agentId, 'Agent identity', { maxLength: 48 });
    const task = validatePlainText(values.task, 'Task', { maxLength: 100 });
    const taskId = validatePlainText(values.taskId, 'Task identifier', { maxLength: 60 });
    const recipients = [...new Set((Array.isArray(values.approvedRecipients) ? values.approvedRecipients : String(values.approvedRecipients ?? '').split(','))
      .map(value => validatePlainText(value, 'Approved recipient', { maxLength: 64 })))];
    if (!recipients.length) throw new TypeError('At least one approved recipient is required.');
    const totalTaskBudget = paiseToAmount(parseAmountToPaise(values.totalTaskBudget, 'Total task budget'));
    const perTransactionCap = paiseToAmount(parseAmountToPaise(values.perTransactionCap, 'Per-transaction cap'));
    const dailyCumulativeCap = paiseToAmount(parseAmountToPaise(values.dailyCumulativeCap, 'Daily cumulative cap'));
    if (perTransactionCap > totalTaskBudget) throw new RangeError('Per-transaction cap cannot exceed the total task budget.');
    if (dailyCumulativeCap > totalTaskBudget) throw new RangeError('Daily cumulative cap cannot exceed the total task budget.');
    const settlementDelayMs = finiteInRange(values.settlementDelaySeconds, 'Settlement delay', 1, 60) * 1_000;
    const violationThreshold = finiteInRange(values.violationThreshold, 'Violation threshold', 1, 100, { integer: true });
    const expiresAt = new Date(values.expiresAt).toISOString();
    if (Number.isNaN(new Date(expiresAt).getTime()) || new Date(expiresAt).getTime() <= this.logicalTime) throw new RangeError('Policy expiry must be after the current simulated session time.');
    const candidate = { ...current, authorisedAgentId: agentId, task, taskId, approvedRecipients: recipients };
    this.pending.clear();
    this.engine = this._newEngine(candidate);
    const result = this.engine.activatePolicy({
      authorisedAgentId: agentId,
      task,
      taskId,
      totalTaskBudget,
      perTransactionCap,
      dailyCumulativeCap,
      approvedRecipients: recipients,
      expiresAt,
      settlementDelayMs,
      violationThreshold,
    }, { ownerId: candidate.ownerId, timestamp: this._nextTimestamp(), resetBudget: true });
    this.lastAttempt = null;
    this.lastOutcome = aggregateRedTeamResults(result, { ledgerEvents: [result.event] });
    return clone(result);
  }

  normalizeAttempt(values = {}) {
    const policy = this.engine.getSnapshot().policy;
    const amountPaise = parseAmountToPaise(values.amount, 'Amount');
    const requestCount = finiteInRange(values.requestCount ?? 1, 'Request count', 1, 10, { integer: true });
    const intervalSeconds = finiteInRange(values.intervalSeconds ?? 0, 'Interval', 0, 60);
    const recipientMode = values.recipientMode === 'custom' ? 'custom' : 'approved';
    const selectedRecipient = recipientMode === 'custom'
      ? validatePlainText(values.customRecipient ?? values.recipient, 'Custom recipient', { maxLength: 64 })
      : validatePlainText(values.recipient ?? policy.approvedRecipients[0], 'Recipient', { maxLength: 64 });
    const taskMode = values.taskMode === 'incorrect' ? 'incorrect' : 'correct';
    const nonceMode = values.nonceMode === 'replay' ? 'replay' : 'fresh';
    if (nonceMode === 'replay' && requestCount === 1 && !this.lastNonce) throw new RangeError('Replay nonce requires a prior attempt or at least two requests.');
    return {
      amount: paiseToAmount(amountPaise), amountPaise, requestCount, intervalSeconds,
      recipientMode, recipient: selectedRecipient,
      taskMode, taskId: taskMode === 'incorrect' ? `${policy.taskId}-UNAUTHORISED` : policy.taskId,
      nonceMode,
      versionMode: values.versionMode === 'stale' ? 'stale' : 'current',
      settlementMode: values.settlementMode === 'pending' ? 'pending' : 'settle',
      agentMode: ['normal', 'overzealous', 'compromised'].includes(values.agentMode) ? values.agentMode : 'normal',
      attemptType: values.attemptType === 'coordinated' || requestCount > 1 ? 'coordinated' : 'single',
      presetLabel: validatePlainText(values.presetLabel ?? 'Custom Attempt', 'Attempt label', { maxLength: 80 }),
    };
  }

  _buildIntents(attempt) {
    const policy = this.engine.getSnapshot().policy;
    const start = new Date(this._nextTimestamp()).getTime();
    const sharedReplayNonce = attempt.nonceMode === 'replay' ? (this.lastNonce ?? `RT-REPLAY-${String(this.sequence + 1).padStart(3, '0')}`) : null;
    const intents = Array.from({ length: attempt.requestCount }, (_, index) => {
      this.sequence += 1;
      const suffix = String(this.sequence).padStart(3, '0');
      const nonce = sharedReplayNonce ?? `RT-NONCE-${suffix}`;
      if (!this.lastNonce) this.lastNonce = nonce;
      return {
        id: `RT-${suffix}`,
        agentId: policy.authorisedAgentId,
        taskId: attempt.taskId,
        amount: attempt.amount,
        recipient: attempt.recipient,
        category: policy.approvedCategory,
        requestedAt: new Date(start + index * attempt.intervalSeconds * 1_000).toISOString(),
        expiresAt: policy.expiresAt,
        policyVersion: attempt.versionMode === 'stale' ? Math.max(0, policy.version - 1) : policy.version,
        nonce,
        status: 'REQUESTED',
      };
    });
    this.logicalTime = Math.max(this.logicalTime, start + attempt.requestCount * Math.max(1_000, attempt.intervalSeconds * 1_000));
    return intents;
  }

  attempt(values) {
    const attempt = this.normalizeAttempt(values);
    const ledgerStart = this.engine.getLedger().length;
    const intents = this._buildIntents(attempt);
    const incidentId = `RED-TEAM-${String(this.sequence).padStart(3, '0')}`;
    const autoSettle = attempt.settlementMode !== 'pending';
    const rawResults = intents.length > 1
      ? this.engine.processIntentBatch(intents, { incidentId, autoSettle })
      : [this.engine.processIntent(intents[0], { incidentId, autoSettle })];
    const results = Array.isArray(rawResults) ? rawResults : [rawResults];
    this.pending.clear();
    for (const result of results.filter(result => result?.decision === 'HOLD' && result.intent?.id)) {
      this.pending.set(result.intent.id, {
        intentId: result.intent.id,
        notBefore: addMilliseconds(result.timestamp, result.settlementDelayMs),
      });
    }
    const outcome = aggregateRedTeamResults(results, {
      requestCount: intents.length,
      combinedAmountPaise: attempt.amountPaise * intents.length,
      windowSeconds: attempt.intervalSeconds * Math.max(0, intents.length - 1),
      presetLabel: attempt.presetLabel,
      attempt,
      ledgerEvents: this.engine.getLedger().slice(ledgerStart),
    });
    this.lastAttempt = clone(attempt);
    this.lastOutcome = clone(outcome);
    return clone(outcome);
  }

  settlePending() {
    if (!this.pending.size) return null;
    const ledgerStart = this.engine.getLedger().length;
    const results = [...this.pending.values()].map(record => this.engine.settleIntent(record.intentId, record.notBefore)).filter(Boolean);
    this.pending.clear();
    const previous = this.lastOutcome ?? {};
    const outcome = aggregateRedTeamResults(results, {
      requestCount: previous.requestCount,
      combinedAmountPaise: previous.combinedAmountPaise,
      windowSeconds: previous.windowSeconds,
      presetLabel: previous.presetLabel,
      attempt: previous.attempt,
      ledgerEvents: this.engine.getLedger().slice(ledgerStart),
    });
    this.lastOutcome = clone(outcome);
    return clone(outcome);
  }

  freezePending() {
    if (!this.pending.size) return null;
    const ledgerStart = this.engine.getLedger().length;
    const result = this.engine.freezeAgent({ ownerId: this.engine.policy.ownerId, timestamp: this._nextTimestamp() });
    this.pending.clear();
    const invalidatedResults = result.invalidated.map(event => ({
      decision: event.decision,
      intent: event.intent,
      ruleChecked: event.ruleChecked,
      rulePassed: false,
      reason: event.reason,
      activePolicyVersion: event.policyVersion,
      riskState: event.riskState,
      riskScore: event.riskScore,
      fundsMoved: event.fundsMoved,
      timestamp: event.timestamp,
      rulesEvaluated: event.rulesEvaluated,
      ledgerEvent: event,
    }));
    const previous = this.lastOutcome ?? {};
    const outcome = aggregateRedTeamResults(invalidatedResults.length ? invalidatedResults : result, {
      requestCount: previous.requestCount,
      combinedAmountPaise: previous.combinedAmountPaise,
      windowSeconds: previous.windowSeconds,
      presetLabel: previous.presetLabel,
      attempt: previous.attempt,
      ledgerEvents: this.engine.getLedger().slice(ledgerStart),
    });
    this.lastOutcome = clone(outcome);
    return clone(outcome);
  }

  replayLast() {
    if (!this.lastAttempt) return null;
    const attempt = clone(this.lastAttempt);
    const policy = clone(this.engine.getSnapshot().policy);
    policy.status = 'ACTIVE';
    this.reset({ policy });
    return this.attempt(attempt);
  }

  getSummary() {
    const ledger = this.engine.getLedger();
    const authorisations = ledger.filter(event => event.eventType === 'AUTHORISATION' && event.intent);
    const intents = new Map();
    for (const event of authorisations) if (!intents.has(event.intent.id)) intents.set(event.intent.id, event.intent);
    const latest = new Map();
    for (const event of ledger.filter(event => event.intent)) latest.set(event.intent.id, event);
    const finalEvents = [...latest.values()];
    const attemptedPaise = [...intents.values()].reduce((sum, intent) => sum + Math.round(intent.amount * 100), 0);
    const movedPaise = ledger.reduce((sum, event) => sum + Math.round(Number(event.fundsMoved ?? 0) * 100), 0);
    const protectedPaise = finalEvents
      .filter(event => ['BLOCKED', 'INVALIDATED'].includes(event.finalSettlementStatus))
      .reduce((sum, event) => sum + Math.round(Number(event.intent?.amount ?? 0) * 100), 0);
    const snapshot = this.engine.getSnapshot();
    return {
      attemptsSubmitted: intents.size,
      approved: authorisations.filter(event => ['HOLD', 'APPROVE'].includes(event.decision)).length,
      blocked: finalEvents.filter(event => event.finalSettlementStatus === 'BLOCKED').length,
      invalidated: finalEvents.filter(event => event.finalSettlementStatus === 'INVALIDATED').length,
      settled: finalEvents.filter(event => event.finalSettlementStatus === 'SETTLED').length,
      pending: snapshot.pendingCount,
      cumulativeAttemptedPaise: attemptedPaise,
      cumulativeFundsMovedPaise: movedPaise,
      protectedValuePaise: protectedPaise,
      finalRiskState: snapshot.risk.state,
      finalRiskScore: snapshot.risk.score,
      finalPolicyVersion: snapshot.policy.version,
      ledgerEvents: ledger.length,
    };
  }
}

export { RULES };
