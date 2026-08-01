const clone = value => JSON.parse(JSON.stringify(value));

export const INTENT_STATUSES = Object.freeze([
  'REQUESTED',
  'POLICY_CHECKED',
  'AUTHORISED',
  'PENDING_SETTLEMENT',
  'SETTLED',
  'BLOCKED',
  'INVALIDATED',
  'FROZEN',
]);

export const DECISIONS = Object.freeze([
  'APPROVE',
  'HOLD',
  'REQUIRE_APPROVAL',
  'BLOCK',
  'INVALIDATE',
  'FREEZE',
]);

export const RULES = Object.freeze({
  AGENT_EXISTS: 'AGENT_EXISTS',
  AGENT_NOT_FROZEN: 'AGENT_NOT_FROZEN',
  POLICY_VERSION_CURRENT: 'POLICY_VERSION_CURRENT',
  TASK_MATCHES_CAPSULE: 'TASK_MATCHES_CAPSULE',
  CAPSULE_NOT_EXPIRED: 'CAPSULE_NOT_EXPIRED',
  RECIPIENT_ALLOWLISTED: 'RECIPIENT_ALLOWLISTED',
  CATEGORY_MATCHES: 'CATEGORY_MATCHES',
  AMOUNT_POSITIVE: 'AMOUNT_POSITIVE',
  PER_TRANSACTION_LIMIT: 'PER_TRANSACTION_LIMIT',
  CUMULATIVE_BUDGET: 'CUMULATIVE_BUDGET',
  NONCE_UNIQUE: 'NONCE_UNIQUE',
  EVASION_SHIELD: 'EVASION_SHIELD',
  RISK_GOVERNOR: 'RISK_GOVERNOR',
  FINAL_SETTLEMENT_REVALIDATION: 'FINAL_SETTLEMENT_REVALIDATION',
  OWNER_CONTROLLED_FREEZE: 'OWNER_CONTROLLED_FREEZE',
  OWNER_POLICY_AUTHORITY: 'OWNER_POLICY_AUTHORITY',
});

export const RULE_ORDER = Object.freeze([
  RULES.AGENT_EXISTS,
  RULES.AGENT_NOT_FROZEN,
  RULES.POLICY_VERSION_CURRENT,
  RULES.TASK_MATCHES_CAPSULE,
  RULES.CAPSULE_NOT_EXPIRED,
  RULES.RECIPIENT_ALLOWLISTED,
  RULES.CATEGORY_MATCHES,
  RULES.AMOUNT_POSITIVE,
  RULES.PER_TRANSACTION_LIMIT,
  RULES.CUMULATIVE_BUDGET,
  RULES.NONCE_UNIQUE,
  RULES.EVASION_SHIELD,
  RULES.RISK_GOVERNOR,
  RULES.FINAL_SETTLEMENT_REVALIDATION,
]);

export const RISK_GOVERNOR = Object.freeze({
  baseScore: 12,
  velocityWindowMs: 10_000,
  retryWindowMs: 60_000,
  thresholds: Object.freeze([
    Object.freeze({ state: 'NORMAL', min: 0, max: 29, response: 'Full authorised autonomy; standard 10 second settlement delay.' }),
    Object.freeze({ state: 'CAUTION', min: 30, max: 54, response: 'Heightened logging; settlement delay increased to at least 15 seconds.' }),
    Object.freeze({ state: 'RESTRICTED', min: 55, max: 74, response: 'New recipients remain disabled; settlement delay increases to 30 seconds; every otherwise valid intent requires owner approval.' }),
    Object.freeze({ state: 'QUARANTINED', min: 75, max: 94, response: 'Settlement is disabled; every otherwise valid intent requires owner approval.' }),
    Object.freeze({ state: 'FROZEN', min: 95, max: 100, response: 'All new intents are blocked; pending intents cannot pass final revalidation.' }),
  ]),
  weights: Object.freeze({
    blockedAttempt: 20,
    newRecipientAttempt: 20,
    retryAfterRejection: 25,
    splitPaymentBehaviour: 25,
    policyModificationAttempt: 20,
    velocityFour: 12,
    velocitySix: 12,
    velocityEight: 50,
  }),
});

export const DEFAULT_POLICY = Object.freeze({
  id: 'PROCUREMENT',
  ownerId: 'TurboPay Technologies Pvt. Ltd.',
  authorisedAgentId: 'Procurement-07',
  taskId: 'CLOUD-CAPACITY-07',
  task: 'Purchase cloud-compute capacity',
  totalTaskBudget: 10_000,
  perTransactionCap: 2_500,
  dailyCumulativeCap: 10_000,
  approvedRecipients: Object.freeze(['CloudGrid', 'ComputeHub']),
  approvedCategory: 'cloud-compute',
  expiresAt: '2026-08-02T18:00:00.000Z',
  settlementDelayMs: 10_000,
  violationThreshold: 55,
  version: 4,
  status: 'ACTIVE',
  evasionShieldEnabled: true,
  riskGovernorEnabled: true,
  inFlightRevocationEnabled: true,
  evasionWindowMs: 15_000,
  evasionMinimumCount: 4,
  evasionNearLimitRatio: 0.75,
  evasionCumulativeThreshold: 5_000,
});

export const LEGACY_POLICY = Object.freeze({
  ...DEFAULT_POLICY,
  id: 'LEGACY',
  approvedRecipients: Object.freeze(['CloudGrid', 'ComputeHub', 'DataForge']),
  perTransactionCap: 2_000,
  version: 1,
  evasionShieldEnabled: false,
  riskGovernorEnabled: false,
  inFlightRevocationEnabled: false,
});

const DEFAULT_RUNTIME = Object.freeze({
  taskSpent: 3_200,
  dailySpent: 3_200,
  approvedCount: 7,
  blockedCount: 3,
  protectedValue: 19_996,
});

function asIso(value, fieldName) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new TypeError(`${fieldName} must be a valid timestamp.`);
  return parsed.toISOString();
}

function addMilliseconds(timestamp, milliseconds) {
  return new Date(new Date(timestamp).getTime() + milliseconds).toISOString();
}

function normalizePolicy(policy) {
  const normalized = { ...clone(DEFAULT_POLICY), ...clone(policy) };
  const numericFields = [
    'totalTaskBudget', 'perTransactionCap', 'dailyCumulativeCap', 'settlementDelayMs',
    'violationThreshold', 'version', 'evasionWindowMs', 'evasionMinimumCount',
    'evasionNearLimitRatio', 'evasionCumulativeThreshold',
  ];
  for (const field of numericFields) {
    normalized[field] = Number(normalized[field]);
    if (!Number.isFinite(normalized[field])) throw new TypeError(`Policy ${field} must be numeric.`);
  }
  if (!normalized.ownerId || !normalized.authorisedAgentId || !normalized.taskId || !normalized.task) {
    throw new TypeError('Policy owner, authorised agent, task id, and task are required.');
  }
  if (normalized.totalTaskBudget <= 0 || normalized.perTransactionCap <= 0 || normalized.dailyCumulativeCap <= 0) {
    throw new RangeError('Policy budgets and transaction cap must be positive.');
  }
  if (!Array.isArray(normalized.approvedRecipients) || normalized.approvedRecipients.length === 0) {
    throw new TypeError('Policy must approve at least one recipient.');
  }
  normalized.approvedRecipients = [...new Set(normalized.approvedRecipients.map(String))];
  normalized.expiresAt = asIso(normalized.expiresAt, 'Policy expiry');
  normalized.status = normalized.status === 'FROZEN' ? 'FROZEN' : 'ACTIVE';
  return normalized;
}

function riskStateForScore(score) {
  return RISK_GOVERNOR.thresholds.find(item => score >= item.min && score <= item.max) ?? RISK_GOVERNOR.thresholds.at(-1);
}

function formatAmount(amount) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount);
}

function intentFingerprint(intent) {
  return [intent.agentId, intent.taskId, intent.recipient, intent.category].join('|');
}

function completeRuntime(initialRuntime = {}) {
  const runtime = { ...clone(DEFAULT_RUNTIME), ...clone(initialRuntime) };
  for (const field of Object.keys(DEFAULT_RUNTIME)) {
    runtime[field] = Number(runtime[field]);
    if (!Number.isFinite(runtime[field]) || runtime[field] < 0) throw new TypeError(`Runtime ${field} must be a non-negative number.`);
  }
  return runtime;
}

export function createIntent(policy, values) {
  const requestedAt = asIso(values.requestedAt, 'Intent requestedAt');
  const intent = {
    id: String(values.id),
    agentId: String(values.agentId),
    taskId: String(values.taskId),
    amount: Number(values.amount),
    recipient: String(values.recipient),
    category: String(values.category),
    requestedAt,
    expiresAt: asIso(values.expiresAt ?? policy.expiresAt, 'Intent expiresAt'),
    policyVersion: Number(values.policyVersion),
    nonce: String(values.nonce),
    status: INTENT_STATUSES.includes(values.status) ? values.status : 'REQUESTED',
  };
  if (!intent.id || !intent.agentId || !intent.taskId || !intent.recipient || !intent.category || !intent.nonce) {
    throw new TypeError('Intent id, agent, task, recipient, category, and nonce are required.');
  }
  return intent;
}

export class AegisPolicyEngine {
  constructor({ policy = DEFAULT_POLICY, initialRuntime = DEFAULT_RUNTIME, agents, clock } = {}) {
    this.initialPolicy = normalizePolicy(policy);
    this.initialRuntime = completeRuntime(initialRuntime);
    this.initialAgents = clone(agents ?? [{ id: this.initialPolicy.authorisedAgentId }]);
    this.clock = clock ?? (() => new Date().toISOString());
    this.reset();
  }

  reset() {
    this.policy = clone(this.initialPolicy);
    this.agents = new Map(this.initialAgents.map(agent => [agent.id, { id: agent.id, frozen: Boolean(agent.frozen) }]));
    this.taskSpent = this.initialRuntime.taskSpent;
    this.dailySpent = this.initialRuntime.dailySpent;
    this.approvedCount = this.initialRuntime.approvedCount;
    this.blockedCount = this.initialRuntime.blockedCount;
    this.protectedValue = this.initialRuntime.protectedValue;
    this.pending = new Map();
    this.approvalRequired = new Map();
    this.nonceOwners = new Map();
    this.history = [];
    this.ledger = [];
    this.eventSequence = 0;
    this.signalIncidentKeys = new Set();
    this.risk = {
      score: RISK_GOVERNOR.baseScore,
      state: 'NORMAL',
      response: RISK_GOVERNOR.thresholds[0].response,
      signals: {
        transactionVelocity: 0,
        repeatedBlockedAttempts: 0,
        newRecipientAttempts: 0,
        retriesAfterRejection: 0,
        splitPaymentBehaviour: 0,
        policyModificationAttempts: 0,
      },
    };
    return this.getSnapshot();
  }

  get policyLabel() {
    return `${this.policy.id}-V${this.policy.version}`;
  }

  getSnapshot() {
    return clone({
      policy: this.policy,
      policyLabel: this.policyLabel,
      taskSpent: this.taskSpent,
      dailySpent: this.dailySpent,
      budgetRemaining: Math.max(0, this.policy.totalTaskBudget - this.taskSpent),
      approvedCount: this.approvedCount,
      blockedCount: this.blockedCount,
      protectedValue: this.protectedValue,
      pendingCount: this.pending.size,
      approvalRequiredCount: this.approvalRequired.size,
      pendingIntents: [...this.pending.values()].map(item => item.intent),
      agents: [...this.agents.values()],
      risk: this.risk,
      usedNonces: [...this.nonceOwners.keys()],
      ledgerLength: this.ledger.length,
    });
  }

  getLedger() {
    return clone(this.ledger);
  }

  _normalizeIntent(values) {
    return createIntent(this.policy, {
      ...values,
      requestedAt: values.requestedAt ?? this.clock(),
      expiresAt: values.expiresAt ?? this.policy.expiresAt,
      policyVersion: values.policyVersion ?? this.policy.version,
      status: values.status ?? 'REQUESTED',
    });
  }

  _appendRule(rulesEvaluated, rule, passed, passReason, failReason) {
    const evaluation = { rule, passed, reason: passed ? passReason : failReason };
    rulesEvaluated.push(evaluation);
    return passed ? null : evaluation;
  }

  _relatedCandidates(intent, context) {
    const supplied = context.relatedIntents ?? [];
    const fromHistory = this.history
      .filter(item => item.intent.id !== intent.id)
      .map(item => item.intent);
    const unique = new Map();
    for (const candidate of [...supplied, ...fromHistory, intent]) unique.set(candidate.id, candidate);
    return [...unique.values()].filter(candidate => intentFingerprint(candidate) === intentFingerprint(intent));
  }

  _evasionFinding(intent, context, effectiveCap) {
    if (!this.policy.evasionShieldEnabled) {
      return { detected: false, reason: 'Evasion Shield is disabled in this policy configuration.', splitDetected: false, retryDetected: false };
    }
    const requestedAt = new Date(intent.requestedAt).getTime();
    const related = this._relatedCandidates(intent, context);
    const withinWindow = related.filter(candidate => Math.abs(new Date(candidate.requestedAt).getTime() - requestedAt) <= this.policy.evasionWindowMs);
    const justBelowLimit = withinWindow.filter(candidate => candidate.amount >= effectiveCap * this.policy.evasionNearLimitRatio && candidate.amount <= effectiveCap);
    const coordinatedValue = justBelowLimit.reduce((sum, candidate) => sum + candidate.amount, 0);
    const splitDetected = justBelowLimit.length >= this.policy.evasionMinimumCount && coordinatedValue > this.policy.evasionCumulativeThreshold;
    if (splitDetected) {
      return {
        detected: true,
        splitDetected: true,
        retryDetected: false,
        coordinatedValue,
        count: justBelowLimit.length,
        reason: `${justBelowLimit.length} related near-limit requests total ${formatAmount(coordinatedValue)} inside ${this.policy.evasionWindowMs / 1000} seconds.`,
      };
    }
    const retry = this.history.find(item =>
      item.decision === 'BLOCK' &&
      intentFingerprint(item.intent) === intentFingerprint(intent) &&
      requestedAt >= new Date(item.intent.requestedAt).getTime() &&
      requestedAt - new Date(item.intent.requestedAt).getTime() <= RISK_GOVERNOR.retryWindowMs
    );
    if (retry) {
      return {
        detected: true,
        splitDetected: false,
        retryDetected: true,
        reason: `Request repeats blocked intent ${retry.intent.id} within ${RISK_GOVERNOR.retryWindowMs / 1000} seconds.`,
      };
    }
    return { detected: false, splitDetected: false, retryDetected: false, reason: 'No coordinated splitting or blocked-request retry pattern detected.' };
  }

  _velocityFor(intent, context) {
    const requestedAt = new Date(intent.requestedAt).getTime();
    const candidates = new Map();
    for (const item of this.history) candidates.set(item.intent.id, item.intent);
    for (const related of context.relatedIntents ?? []) candidates.set(related.id, related);
    candidates.set(intent.id, intent);
    return [...candidates.values()].filter(candidate =>
      candidate.agentId === intent.agentId &&
      Math.abs(new Date(candidate.requestedAt).getTime() - requestedAt) <= RISK_GOVERNOR.velocityWindowMs
    ).length;
  }

  _riskScore(signals) {
    const weights = RISK_GOVERNOR.weights;
    const velocityWeight = signals.transactionVelocity >= 8
      ? weights.velocityEight
      : signals.transactionVelocity >= 6
        ? weights.velocitySix
        : signals.transactionVelocity >= 4
          ? weights.velocityFour
          : 0;
    return Math.min(100,
      RISK_GOVERNOR.baseScore +
      (signals.repeatedBlockedAttempts > 0
        ? weights.blockedAttempt + (signals.repeatedBlockedAttempts - 1) * 5
        : 0) +
      signals.newRecipientAttempts * weights.newRecipientAttempt +
      signals.retriesAfterRejection * weights.retryAfterRejection +
      signals.splitPaymentBehaviour * weights.splitPaymentBehaviour +
      signals.policyModificationAttempts * weights.policyModificationAttempt +
      velocityWeight
    );
  }

  _projectRisk(intent, context, evasion) {
    const signals = clone(this.risk.signals);
    signals.transactionVelocity = Math.max(signals.transactionVelocity, this._velocityFor(intent, context));
    const incidentId = context.incidentId ?? intent.id;
    if (evasion.retryDetected && !this.signalIncidentKeys.has(`retry:${incidentId}`)) signals.retriesAfterRejection += 1;
    if (evasion.splitDetected) signals.splitPaymentBehaviour = 1;
    const score = this.policy.riskGovernorEnabled ? this._riskScore(signals) : RISK_GOVERNOR.baseScore;
    const threshold = riskStateForScore(score);
    return { score, state: threshold.state, response: threshold.response, signals };
  }

  _effectiveCap(riskState = this.risk.state) {
    if (riskState === 'QUARANTINED' || riskState === 'FROZEN') return 0;
    return this.policy.perTransactionCap;
  }

  _effectiveSettlementDelay(riskState = this.risk.state) {
    if (riskState === 'CAUTION') return Math.max(this.policy.settlementDelayMs, 15_000);
    if (riskState === 'RESTRICTED') return Math.max(this.policy.settlementDelayMs, 30_000);
    return this.policy.settlementDelayMs;
  }

  _evaluateRules(intent, context = {}) {
    const rulesEvaluated = [];
    const settlementTimestamp = context.timestamp ?? intent.requestedAt;
    const agent = this.agents.get(intent.agentId);
    let failure;

    const agentAuthorised = Boolean(agent) && intent.agentId === this.policy.authorisedAgentId;
    failure = this._appendRule(rulesEvaluated, RULES.AGENT_EXISTS, agentAuthorised, `Agent ${intent.agentId} exists and is the policy-authorised agent.`, `Agent ${intent.agentId} is absent or is not authorised by this policy.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    failure = this._appendRule(rulesEvaluated, RULES.AGENT_NOT_FROZEN, !agent.frozen && this.policy.status === 'ACTIVE', `Agent ${intent.agentId} and policy ${this.policyLabel} are active.`, `Agent ${intent.agentId} or policy ${this.policyLabel} is frozen.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    failure = this._appendRule(rulesEvaluated, RULES.POLICY_VERSION_CURRENT, intent.policyVersion === this.policy.version, `Intent policy version ${intent.policyVersion} is current.`, `Intent policy version ${intent.policyVersion} does not match active version ${this.policy.version}.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    failure = this._appendRule(rulesEvaluated, RULES.TASK_MATCHES_CAPSULE, intent.taskId === this.policy.taskId, `Task ${intent.taskId} matches the Budget Capsule.`, `Task ${intent.taskId} does not match capsule task ${this.policy.taskId}.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const notExpired = new Date(settlementTimestamp).getTime() <= new Date(this.policy.expiresAt).getTime() && new Date(settlementTimestamp).getTime() <= new Date(intent.expiresAt).getTime();
    failure = this._appendRule(rulesEvaluated, RULES.CAPSULE_NOT_EXPIRED, notExpired, `Capsule and intent remain valid at ${settlementTimestamp}.`, `Capsule or intent expired before ${settlementTimestamp}.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const recipientAllowed = this.policy.approvedRecipients.includes(intent.recipient);
    failure = this._appendRule(rulesEvaluated, RULES.RECIPIENT_ALLOWLISTED, recipientAllowed, `Recipient ${intent.recipient} is allowlisted.`, `Recipient ${intent.recipient} is not allowlisted.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const categoryMatches = intent.category === this.policy.approvedCategory;
    failure = this._appendRule(rulesEvaluated, RULES.CATEGORY_MATCHES, categoryMatches, `Category ${intent.category} matches the capsule.`, `Category ${intent.category} does not match approved category ${this.policy.approvedCategory}.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const positiveAmount = Number.isFinite(intent.amount) && intent.amount > 0;
    failure = this._appendRule(rulesEvaluated, RULES.AMOUNT_POSITIVE, positiveAmount, `Amount ${formatAmount(intent.amount)} is positive.`, `Amount must be positive; received ${intent.amount}.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const effectiveCap = this._effectiveCap();
    const withinTransactionCap = intent.amount <= effectiveCap;
    failure = this._appendRule(rulesEvaluated, RULES.PER_TRANSACTION_LIMIT, withinTransactionCap, `${formatAmount(intent.amount)} is within the effective ${formatAmount(effectiveCap)} cap.`, `${formatAmount(intent.amount)} exceeds the effective ${formatAmount(effectiveCap)} per-transaction cap by ${formatAmount(intent.amount - effectiveCap)}.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const reserved = [...this.pending.values()]
      .filter(item => item.intent.id !== context.excludePendingIntentId)
      .reduce((sum, item) => sum + item.intent.amount, 0);
    const projectedTaskSpend = this.taskSpent + reserved + intent.amount;
    const projectedDailySpend = this.dailySpent + reserved + intent.amount;
    const withinCumulative = projectedTaskSpend <= this.policy.totalTaskBudget && projectedDailySpend <= this.policy.dailyCumulativeCap;
    const cumulativeFailReason = projectedTaskSpend > this.policy.totalTaskBudget
      ? `Projected task spend ${formatAmount(projectedTaskSpend)} exceeds the ${formatAmount(this.policy.totalTaskBudget)} capsule budget.`
      : `Projected daily spend ${formatAmount(projectedDailySpend)} exceeds the ${formatAmount(this.policy.dailyCumulativeCap)} daily cap.`;
    failure = this._appendRule(rulesEvaluated, RULES.CUMULATIVE_BUDGET, withinCumulative, `Projected task and daily spend of ${formatAmount(projectedTaskSpend)} remain within policy.`, cumulativeFailReason);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const nonceOwner = this.nonceOwners.get(intent.nonce);
    const nonceUnique = !nonceOwner || (context.phase === 'SETTLEMENT' && nonceOwner === intent.id);
    failure = this._appendRule(rulesEvaluated, RULES.NONCE_UNIQUE, nonceUnique, `Nonce ${intent.nonce} has not been used by another intent.`, `Nonce ${intent.nonce} was already used by intent ${nonceOwner}.`);
    if (failure) return { rulesEvaluated, failure, evasion: {}, projectedRisk: clone(this.risk) };
    const evasion = context.phase === 'SETTLEMENT'
      ? { detected: false, splitDetected: false, retryDetected: false, reason: 'No new evasion signal appeared during final revalidation.' }
      : this._evasionFinding(intent, context, effectiveCap);
    failure = this._appendRule(rulesEvaluated, RULES.EVASION_SHIELD, !evasion.detected, evasion.reason, evasion.reason);
    if (failure) return { rulesEvaluated, failure, evasion, projectedRisk: this._projectRisk(intent, context, evasion) };
    const projectedRisk = context.phase === 'SETTLEMENT' ? clone(this.risk) : this._projectRisk(intent, context, evasion);
    const riskAllowsAutonomy = context.ownerApproval || !this.policy.riskGovernorEnabled || projectedRisk.score < this.policy.violationThreshold;
    const riskReason = this.policy.riskGovernorEnabled
      ? `Risk score ${projectedRisk.score} is ${projectedRisk.state}. ${projectedRisk.response}`
      : 'Risk Governor is disabled in this policy configuration.';
    failure = this._appendRule(rulesEvaluated, RULES.RISK_GOVERNOR, riskAllowsAutonomy, riskReason, riskReason);
    return { rulesEvaluated, failure, evasion, projectedRisk };
  }

  _applyRiskSignals(intent, context, result, evaluation) {
    if (this.policy.status === 'FROZEN' || this.risk.state === 'FROZEN') return;
    const incidentId = context.incidentId ?? intent.id;
    const signals = clone(this.risk.signals);
    signals.transactionVelocity = Math.max(signals.transactionVelocity, this._velocityFor(intent, context));
    if (result.decision === 'BLOCK' && !this.signalIncidentKeys.has(`blocked:${incidentId}`)) {
      signals.repeatedBlockedAttempts += 1;
      this.signalIncidentKeys.add(`blocked:${incidentId}`);
    }
    if (!this.policy.approvedRecipients.includes(intent.recipient) && !this.signalIncidentKeys.has(`recipient:${incidentId}`)) {
      signals.newRecipientAttempts += 1;
      this.signalIncidentKeys.add(`recipient:${incidentId}`);
    }
    if (evaluation.evasion?.retryDetected && !this.signalIncidentKeys.has(`retry:${incidentId}`)) {
      signals.retriesAfterRejection += 1;
      this.signalIncidentKeys.add(`retry:${incidentId}`);
    }
    if (evaluation.evasion?.splitDetected) signals.splitPaymentBehaviour = 1;
    const score = this.policy.riskGovernorEnabled ? this._riskScore(signals) : RISK_GOVERNOR.baseScore;
    const threshold = riskStateForScore(score);
    this.risk = { score, state: threshold.state, response: threshold.response, signals };
  }

  _recordLedger({ eventType, intent = null, decision, reason, ruleChecked, rulesEvaluated = [], ownerAction = null, finalSettlementStatus, fundsMoved = 0, timestamp, policyVersion }) {
    const event = {
      id: `EVT-${String(++this.eventSequence).padStart(4, '0')}`,
      eventType,
      intent: intent ? clone(intent) : null,
      agent: intent?.agentId ?? this.policy.authorisedAgentId,
      owner: this.policy.ownerId,
      activeTask: { id: this.policy.taskId, name: this.policy.task },
      policyVersion: policyVersion ?? this.policy.version,
      policyLabel: this.policyLabel,
      rulesEvaluated: clone(rulesEvaluated),
      riskSignals: clone(this.risk.signals),
      riskState: this.risk.state,
      riskScore: this.risk.score,
      decision,
      reason,
      ruleChecked,
      ownerAction,
      finalSettlementStatus,
      fundsMoved,
      timestamp: asIso(timestamp ?? this.clock(), 'Ledger timestamp'),
      simulatedFunds: true,
    };
    this.ledger.push(event);
    return clone(event);
  }

  authoriseIntent(values, context = {}) {
    const intent = this._normalizeIntent(values);
    intent.status = 'POLICY_CHECKED';
    const evaluation = this._evaluateRules(intent, { ...context, phase: 'AUTHORISATION' });
    let decision = 'HOLD';
    let reason = `All 13 authorisation checks passed; ${formatAmount(intent.amount)} is pending final settlement revalidation.`;
    let status = 'PENDING_SETTLEMENT';
    if (evaluation.failure) {
      decision = evaluation.failure.rule === RULES.RISK_GOVERNOR ? 'REQUIRE_APPROVAL' : 'BLOCK';
      reason = evaluation.failure.reason;
      status = decision === 'BLOCK' ? 'BLOCKED' : 'POLICY_CHECKED';
    }
    intent.status = status;
    const result = {
      decision,
      intent: clone(intent),
      ruleChecked: evaluation.failure?.rule ?? RULES.RISK_GOVERNOR,
      rulePassed: !evaluation.failure,
      reason,
      activePolicyVersion: this.policy.version,
      riskState: this.risk.state,
      riskScore: this.risk.score,
      fundsMoved: 0,
      timestamp: intent.requestedAt,
      rulesEvaluated: clone(evaluation.rulesEvaluated),
    };
    if (evaluation.rulesEvaluated.some(rule => rule.rule === RULES.NONCE_UNIQUE && rule.passed)) this.nonceOwners.set(intent.nonce, intent.id);
    this._applyRiskSignals(intent, context, result, evaluation);
    result.riskState = this.risk.state;
    result.riskScore = this.risk.score;
    result.settlementDelayMs = this._effectiveSettlementDelay(result.riskState);
    if (decision === 'HOLD') this.pending.set(intent.id, {
      intent: clone(intent),
      authorisation: clone(result),
      notBefore: addMilliseconds(intent.requestedAt, result.settlementDelayMs),
    });
    if (decision === 'REQUIRE_APPROVAL') this.approvalRequired.set(intent.id, { intent: clone(intent), authorisation: clone(result) });
    if (decision === 'BLOCK' || decision === 'REQUIRE_APPROVAL') {
      this.blockedCount += 1;
      if (decision === 'BLOCK') this.protectedValue += Math.max(0, intent.amount);
    }
    this.history.push({ intent: clone(intent), decision, ruleChecked: result.ruleChecked, incidentId: context.incidentId ?? intent.id });
    result.ledgerEvent = this._recordLedger({
      eventType: 'AUTHORISATION', intent, decision, reason, ruleChecked: result.ruleChecked,
      rulesEvaluated: evaluation.rulesEvaluated, finalSettlementStatus: status,
      fundsMoved: 0, timestamp: intent.requestedAt,
    });
    return clone(result);
  }

  settleIntent(intentId, timestamp) {
    const pendingRecord = this.pending.get(intentId);
    if (!pendingRecord) return null;
    const intent = clone(pendingRecord.intent);
    const settlementTimestamp = asIso(timestamp ?? pendingRecord.notBefore ?? addMilliseconds(intent.requestedAt, this.policy.settlementDelayMs), 'Settlement timestamp');
    if (pendingRecord.notBefore && new Date(settlementTimestamp).getTime() < new Date(pendingRecord.notBefore).getTime()) {
      const reason = `Settlement remains on hold until ${pendingRecord.notBefore}.`;
      const rulesEvaluated = [
        ...pendingRecord.authorisation.rulesEvaluated,
        { rule: RULES.FINAL_SETTLEMENT_REVALIDATION, passed: false, reason },
      ];
      const result = {
        decision: 'HOLD', intent, ruleChecked: RULES.FINAL_SETTLEMENT_REVALIDATION,
        rulePassed: false, reason, activePolicyVersion: this.policy.version,
        riskState: this.risk.state, riskScore: this.risk.score, fundsMoved: 0,
        timestamp: settlementTimestamp, rulesEvaluated,
      };
      result.ledgerEvent = this._recordLedger({
        eventType: 'SETTLEMENT_DEFERRED', intent, decision: 'HOLD', reason,
        ruleChecked: result.ruleChecked, rulesEvaluated,
        finalSettlementStatus: 'PENDING_SETTLEMENT', fundsMoved: 0, timestamp: settlementTimestamp,
      });
      return clone(result);
    }
    let rulesEvaluated;
    let invalidReason = null;
    if (this.policy.inFlightRevocationEnabled) {
      const evaluation = this._evaluateRules(intent, {
        phase: 'SETTLEMENT', timestamp: settlementTimestamp, excludePendingIntentId: intent.id,
        ownerApproval: Boolean(pendingRecord.ownerApproved),
      });
      rulesEvaluated = evaluation.rulesEvaluated;
      if (evaluation.failure) invalidReason = evaluation.failure.reason;
    } else {
      rulesEvaluated = clone(pendingRecord.authorisation.rulesEvaluated);
    }
    const finalValid = !invalidReason && intent.status === 'PENDING_SETTLEMENT';
    rulesEvaluated.push({
      rule: RULES.FINAL_SETTLEMENT_REVALIDATION,
      passed: finalValid,
      reason: finalValid
        ? this.policy.inFlightRevocationEnabled
          ? `Intent ${intent.id} remained valid through final revalidation.`
          : `Legacy policy settled intent ${intent.id} from its Phase 1 authorisation without revalidation.`
        : `Final revalidation failed: ${invalidReason ?? `intent status is ${intent.status}`}`,
    });
    this.pending.delete(intent.id);
    if (!finalValid) {
      intent.status = 'INVALIDATED';
      this.blockedCount += 1;
      this.protectedValue += intent.amount;
      const reason = rulesEvaluated.at(-1).reason;
      const result = {
        decision: 'INVALIDATE', intent, ruleChecked: RULES.FINAL_SETTLEMENT_REVALIDATION,
        rulePassed: false, reason, activePolicyVersion: this.policy.version,
        riskState: this.risk.state, riskScore: this.risk.score, fundsMoved: 0,
        timestamp: settlementTimestamp, rulesEvaluated,
      };
      result.ledgerEvent = this._recordLedger({
        eventType: 'SETTLEMENT', intent, decision: result.decision, reason,
        ruleChecked: result.ruleChecked, rulesEvaluated, finalSettlementStatus: intent.status,
        fundsMoved: 0, timestamp: settlementTimestamp,
      });
      return clone(result);
    }
    intent.status = 'SETTLED';
    this.taskSpent += intent.amount;
    this.dailySpent += intent.amount;
    this.approvedCount += 1;
    const reason = this.policy.inFlightRevocationEnabled
      ? `Final revalidation passed; ${formatAmount(intent.amount)} settled to ${intent.recipient}.`
      : `Legacy Phase 1 authority settled ${formatAmount(intent.amount)} without final revalidation.`;
    const result = {
      decision: 'APPROVE', intent, ruleChecked: RULES.FINAL_SETTLEMENT_REVALIDATION,
      rulePassed: true, reason, activePolicyVersion: this.policy.version,
      riskState: this.risk.state, riskScore: this.risk.score, fundsMoved: intent.amount,
      timestamp: settlementTimestamp, rulesEvaluated,
    };
    result.ledgerEvent = this._recordLedger({
      eventType: 'SETTLEMENT', intent, decision: result.decision, reason,
      ruleChecked: result.ruleChecked, rulesEvaluated, finalSettlementStatus: intent.status,
      fundsMoved: intent.amount, timestamp: settlementTimestamp,
    });
    return clone(result);
  }

  processIntent(values, options = {}) {
    const authorisation = this.authoriseIntent(values, options);
    if (authorisation.decision !== 'HOLD' || options.autoSettle === false) return authorisation;
    return this.settleIntent(authorisation.intent.id, options.settlementTimestamp ?? addMilliseconds(authorisation.intent.requestedAt, authorisation.settlementDelayMs));
  }

  processIntentBatch(valuesList, options = {}) {
    const intents = valuesList.map(values => this._normalizeIntent(values));
    const incidentId = options.incidentId ?? `BATCH-${intents[0]?.id ?? 'EMPTY'}`;
    const authorisations = intents.map(intent => this.authoriseIntent(intent, { relatedIntents: intents, incidentId }));
    if (options.autoSettle === false) return authorisations;
    return authorisations.map(result => result.decision === 'HOLD'
      ? this.settleIntent(result.intent.id, addMilliseconds(result.intent.requestedAt, result.settlementDelayMs))
      : result
    );
  }

  approveIntent(intentId, { ownerId, timestamp } = {}) {
    const queued = this.approvalRequired.get(intentId);
    if (!queued) return null;
    const at = asIso(timestamp ?? this.clock(), 'Approval timestamp');
    if (ownerId !== this.policy.ownerId) {
      const event = this.recordPolicyModificationAttempt({ agentId: String(ownerId ?? 'UNKNOWN'), timestamp: at });
      return {
        decision: 'BLOCK', ruleChecked: RULES.OWNER_POLICY_AUTHORITY, rulePassed: false,
        reason: `Only owner ${this.policy.ownerId} may approve a held intent.`,
        activePolicyVersion: this.policy.version, riskState: this.risk.state,
        riskScore: this.risk.score, fundsMoved: 0, timestamp: at,
        rulesEvaluated: event.rulesEvaluated,
      };
    }
    const intent = { ...queued.intent, status: 'PENDING_SETTLEMENT' };
    const rulesEvaluated = queued.authorisation.rulesEvaluated.map(rule => rule.rule === RULES.RISK_GOVERNOR
      ? { ...rule, passed: true, reason: `Verified owner ${ownerId} approved this intent under ${this.risk.state} controls.` }
      : rule
    );
    const result = {
      decision: 'HOLD', intent: clone(intent), ruleChecked: RULES.RISK_GOVERNOR,
      rulePassed: true, reason: `Owner approval received; ${formatAmount(intent.amount)} is pending final settlement revalidation.`,
      activePolicyVersion: this.policy.version, riskState: this.risk.state,
      riskScore: this.risk.score, fundsMoved: 0, timestamp: at, rulesEvaluated,
      settlementDelayMs: this._effectiveSettlementDelay(this.risk.state),
    };
    this.approvalRequired.delete(intentId);
    this.pending.set(intentId, {
      intent: clone(intent), authorisation: clone(result), ownerApproved: true,
      notBefore: addMilliseconds(intent.requestedAt, result.settlementDelayMs),
    });
    result.ledgerEvent = this._recordLedger({
      eventType: 'OWNER_ACTION', intent, decision: 'HOLD', reason: result.reason,
      ruleChecked: RULES.RISK_GOVERNOR, rulesEvaluated, ownerAction: 'APPROVE_INTENT',
      finalSettlementStatus: 'PENDING_SETTLEMENT', fundsMoved: 0, timestamp: at,
    });
    return clone(result);
  }

  freezeAgent({ ownerId, timestamp } = {}) {
    const at = asIso(timestamp ?? this.clock(), 'Freeze timestamp');
    if (ownerId !== this.policy.ownerId) {
      const event = this.recordPolicyModificationAttempt({ agentId: String(ownerId ?? 'UNKNOWN'), timestamp: at });
      return {
        decision: 'BLOCK', ruleChecked: RULES.OWNER_CONTROLLED_FREEZE, rulePassed: false,
        reason: `Only owner ${this.policy.ownerId} may freeze this policy.`,
        activePolicyVersion: this.policy.version, riskState: this.risk.state,
        riskScore: this.risk.score, fundsMoved: 0, timestamp: at,
        rulesEvaluated: event.rulesEvaluated, invalidated: [],
      };
    }
    const agent = this.agents.get(this.policy.authorisedAgentId);
    if (agent) agent.frozen = true;
    this.policy.status = 'FROZEN';
    this.policy.version += 1;
    this.risk = {
      ...this.risk,
      score: 100,
      state: 'FROZEN',
      response: RISK_GOVERNOR.thresholds.at(-1).response,
    };
    const freezeRules = [{ rule: RULES.OWNER_CONTROLLED_FREEZE, passed: true, reason: `Verified owner ${ownerId} revoked agent authority.` }];
    const freezeEvent = this._recordLedger({
      eventType: 'OWNER_ACTION', decision: 'FREEZE',
      reason: `Owner froze ${this.policy.authorisedAgentId}; active policy advanced to version ${this.policy.version}.`,
      ruleChecked: RULES.OWNER_CONTROLLED_FREEZE, rulesEvaluated: freezeRules,
      ownerAction: 'FREEZE_AGENT', finalSettlementStatus: 'FROZEN', fundsMoved: 0, timestamp: at,
    });
    const invalidated = [];
    this.approvalRequired.clear();
    if (this.policy.inFlightRevocationEnabled) {
      for (const [intentId, pendingRecord] of [...this.pending.entries()]) {
        this.pending.delete(intentId);
        const intent = { ...pendingRecord.intent, status: 'INVALIDATED' };
        const rulesEvaluated = [
          ...pendingRecord.authorisation.rulesEvaluated,
          { rule: RULES.FINAL_SETTLEMENT_REVALIDATION, passed: false, reason: `Owner freeze invalidated ${intent.id} before settlement.` },
        ];
        this.blockedCount += 1;
        this.protectedValue += intent.amount;
        const event = this._recordLedger({
          eventType: 'SETTLEMENT', intent, decision: 'INVALIDATE',
          reason: `Owner freeze invalidated ${intent.id} before final settlement; funds moved ${formatAmount(0)}.`,
          ruleChecked: RULES.FINAL_SETTLEMENT_REVALIDATION, rulesEvaluated,
          ownerAction: 'FREEZE_AGENT', finalSettlementStatus: 'INVALIDATED', fundsMoved: 0, timestamp: at,
        });
        invalidated.push(event);
      }
    }
    return {
      decision: 'FREEZE',
      ruleChecked: RULES.OWNER_CONTROLLED_FREEZE,
      rulePassed: true,
      reason: freezeEvent.reason,
      activePolicyVersion: this.policy.version,
      riskState: this.risk.state,
      riskScore: this.risk.score,
      fundsMoved: 0,
      timestamp: at,
      rulesEvaluated: freezeRules,
      freezeEvent,
      invalidated,
    };
  }

  activatePolicy(updates, { ownerId, timestamp, resetBudget = true } = {}) {
    const at = asIso(timestamp ?? this.clock(), 'Policy activation timestamp');
    if (ownerId !== this.policy.ownerId) {
      const event = this.recordPolicyModificationAttempt({ agentId: String(ownerId ?? 'UNKNOWN'), timestamp: at });
      return {
        decision: 'BLOCK', ruleChecked: RULES.OWNER_POLICY_AUTHORITY, rulePassed: false,
        reason: `Only owner ${this.policy.ownerId} may activate a policy.`,
        activePolicyVersion: this.policy.version, riskState: this.risk.state,
        riskScore: this.risk.score, fundsMoved: 0, timestamp: at,
        rulesEvaluated: event.rulesEvaluated,
      };
    }
    const oldVersion = this.policy.version;
    this.policy = normalizePolicy({ ...this.policy, ...clone(updates), version: oldVersion + 1, status: 'ACTIVE' });
    if (resetBudget) {
      this.taskSpent = 0;
      this.dailySpent = 0;
    }
    const event = this._recordLedger({
      eventType: 'POLICY_ACTIVATED', decision: 'APPROVE',
      reason: `Owner activated ${this.policyLabel} for task ${this.policy.taskId}.`,
      ruleChecked: RULES.OWNER_POLICY_AUTHORITY,
      rulesEvaluated: [{ rule: RULES.OWNER_POLICY_AUTHORITY, passed: true, reason: `Verified owner ${ownerId}.` }],
      ownerAction: 'ACTIVATE_POLICY', finalSettlementStatus: 'POLICY_CHECKED', fundsMoved: 0, timestamp: at,
    });
    return {
      decision: 'APPROVE',
      ruleChecked: RULES.OWNER_POLICY_AUTHORITY,
      rulePassed: true,
      reason: event.reason,
      activePolicyVersion: this.policy.version,
      riskState: this.risk.state,
      riskScore: this.risk.score,
      fundsMoved: 0,
      timestamp: at,
      rulesEvaluated: event.rulesEvaluated,
      policy: clone(this.policy),
      event,
    };
  }

  recordPolicyModificationAttempt({ agentId, timestamp } = {}) {
    const at = asIso(timestamp ?? this.clock(), 'Policy modification timestamp');
    this.risk.signals.policyModificationAttempts += 1;
    const score = this.policy.riskGovernorEnabled ? this._riskScore(this.risk.signals) : RISK_GOVERNOR.baseScore;
    const threshold = riskStateForScore(score);
    this.risk = { ...this.risk, score, state: threshold.state, response: threshold.response };
    return this._recordLedger({
      eventType: 'POLICY_MODIFICATION_ATTEMPT', decision: 'BLOCK',
      reason: `Unauthorised actor ${agentId} attempted to modify owner-controlled policy.`,
      ruleChecked: RULES.OWNER_POLICY_AUTHORITY,
      rulesEvaluated: [{ rule: RULES.OWNER_POLICY_AUTHORITY, passed: false, reason: `Actor ${agentId} is not owner ${this.policy.ownerId}.` }],
      finalSettlementStatus: 'BLOCKED', fundsMoved: 0, timestamp: at,
    });
  }
}

function suiteIntent(engine, id, at, overrides = {}) {
  return {
    id,
    agentId: engine.policy.authorisedAgentId,
    taskId: engine.policy.taskId,
    amount: 1_000,
    recipient: 'CloudGrid',
    category: engine.policy.approvedCategory,
    requestedAt: at,
    expiresAt: engine.policy.expiresAt,
    policyVersion: engine.policy.version,
    nonce: `NONCE-${id}`,
    status: 'REQUESTED',
    ...overrides,
  };
}

function attackOutcome(name, engine, results) {
  const ledger = engine.getLedger();
  const fundsMoved = ledger.reduce((sum, event) => sum + event.fundsMoved, 0);
  const finalResult = Array.isArray(results) ? results.at(-1) : results;
  return {
    name,
    attackSucceeded: fundsMoved > 0,
    fundsMoved,
    finalDecision: finalResult?.decision ?? 'BLOCK',
    reason: finalResult?.reason ?? 'No settlement occurred.',
    ledger,
  };
}

export function runAttackSuite(policy) {
  const runtime = { taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 };
  const makeEngine = () => new AegisPolicyEngine({ policy, initialRuntime: runtime, clock: () => '2026-08-01T10:00:00.000Z' });
  const outcomes = [];

  let engine = makeEngine();
  let result = engine.processIntent(suiteIntent(engine, 'OVERSIZED', '2026-08-01T10:00:00.000Z', { amount: engine.policy.perTransactionCap + 1 }));
  outcomes.push(attackOutcome('Oversized payment', engine, result));

  engine = makeEngine();
  result = engine.processIntent(suiteIntent(engine, 'UNKNOWN', '2026-08-01T10:01:00.000Z', { recipient: 'UnknownCounterparty' }));
  outcomes.push(attackOutcome('Unknown recipient', engine, result));

  engine = makeEngine();
  const splitAmounts = [0, 1, 2, 3].map(index => suiteIntent(engine, `SPLIT-${index + 1}`, `2026-08-01T10:02:${String(index * 3).padStart(2, '0')}.000Z`, { amount: 1_999 }));
  result = engine.processIntentBatch(splitAmounts, { incidentId: 'SPLIT-ATTACK' });
  outcomes.push(attackOutcome('Threshold splitting', engine, result));

  engine = makeEngine();
  const rapid = Array.from({ length: 8 }, (_, index) => suiteIntent(engine, `RAPID-${index + 1}`, `2026-08-01T10:03:0${Math.floor(index / 2)}.${index % 2 ? '500' : '000'}Z`, { amount: 800 }));
  result = engine.processIntentBatch(rapid, { incidentId: 'RAPID-ATTACK' });
  outcomes.push(attackOutcome('Rapid fire', engine, result));

  engine = makeEngine();
  engine.processIntent(suiteIntent(engine, 'RETRY-1', '2026-08-01T10:04:00.000Z', { amount: engine.policy.perTransactionCap + 1 }));
  result = engine.processIntent(suiteIntent(engine, 'RETRY-2', '2026-08-01T10:04:02.000Z', { amount: 1_000 }));
  outcomes.push(attackOutcome('Retry after rejection', engine, result));

  engine = makeEngine();
  const pending = engine.authoriseIntent(suiteIntent(engine, 'PENDING', '2026-08-01T10:05:00.000Z', { amount: 1_000 }));
  engine.freezeAgent({ ownerId: engine.policy.ownerId, timestamp: '2026-08-01T10:05:04.000Z' });
  result = engine.settleIntent(pending.intent.id, '2026-08-01T10:05:10.000Z') ?? engine.getLedger().at(-1);
  outcomes.push(attackOutcome('Pending intent after freeze', engine, result));

  return {
    policy: clone(policy),
    attacks: outcomes,
    attacksSucceeded: outcomes.filter(outcome => outcome.attackSucceeded).length,
    attacksContained: outcomes.filter(outcome => !outcome.attackSucceeded).length,
  };
}

export function runPolicyDigitalTwin({ legacyPolicy = LEGACY_POLICY, hardenedPolicy = { ...DEFAULT_POLICY, perTransactionCap: 2_000, approvedRecipients: ['CloudGrid', 'ComputeHub', 'DataForge'] } } = {}) {
  return {
    legacy: runAttackSuite(normalizePolicy(legacyPolicy)),
    hardened: runAttackSuite(normalizePolicy(hardenedPolicy)),
  };
}
