export const JUDGE_MODE_STATES = Object.freeze({
  READY: 'READY',
  RUNNING: 'RUNNING',
  AWAITING_OWNER_ACTION: 'AWAITING_OWNER_ACTION',
  COMPLETE: 'COMPLETE',
  ERROR: 'ERROR',
});

const clone = value => JSON.parse(JSON.stringify(value));

export class JudgeModeStateMachine {
  constructor({
    scenarioCount,
    setTimeoutFn = globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout.bind(globalThis),
    setIntervalFn = globalThis.setInterval.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval.bind(globalThis),
    onChange = () => {},
  }) {
    if (!Number.isInteger(scenarioCount) || scenarioCount < 1) throw new TypeError('Judge Mode requires at least one scenario.');
    this.scenarioCount = scenarioCount;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.onChange = onChange;
    this.timeouts = new Set();
    this.intervals = new Set();
    this.isOpen = false;
    this.scenarioIndex = 0;
    this.status = JUDGE_MODE_STATES.READY;
    this.runToken = 0;
    this.errorMessage = null;
  }

  snapshot() {
    const conflicting = [JUDGE_MODE_STATES.RUNNING, JUDGE_MODE_STATES.AWAITING_OWNER_ACTION].includes(this.status);
    return Object.freeze({
      isOpen: this.isOpen,
      scenarioIndex: this.scenarioIndex,
      scenarioCount: this.scenarioCount,
      status: this.status,
      runToken: this.runToken,
      errorMessage: this.errorMessage,
      activeTimerCount: this.timeouts.size + this.intervals.size,
      canStart: this.isOpen && this.status === JUDGE_MODE_STATES.READY,
      canPrevious: this.isOpen && !conflicting && this.scenarioIndex > 0,
      canNext: this.isOpen && [JUDGE_MODE_STATES.COMPLETE, JUDGE_MODE_STATES.ERROR].includes(this.status),
      canRestart: this.isOpen && this.status !== JUDGE_MODE_STATES.RUNNING,
      awaitingOwnerAction: this.status === JUDGE_MODE_STATES.AWAITING_OWNER_ACTION,
    });
  }

  _emit() {
    this.onChange(this.snapshot());
  }

  open() {
    this.clearAsync();
    this.isOpen = true;
    this.scenarioIndex = 0;
    this.status = JUDGE_MODE_STATES.READY;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return this.snapshot();
  }

  close() {
    this.clearAsync();
    this.isOpen = false;
    this.status = JUDGE_MODE_STATES.READY;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return this.snapshot();
  }

  reset({ preserveOpen = this.isOpen } = {}) {
    this.clearAsync();
    this.isOpen = preserveOpen;
    this.scenarioIndex = 0;
    this.status = JUDGE_MODE_STATES.READY;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return this.snapshot();
  }

  prepareScenario(index) {
    if (!this.isOpen || !Number.isInteger(index) || index < 0 || index >= this.scenarioCount) return false;
    this.clearAsync();
    this.scenarioIndex = index;
    this.status = JUDGE_MODE_STATES.READY;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return true;
  }

  start() {
    if (!this.isOpen || this.status !== JUDGE_MODE_STATES.READY) return null;
    this.clearAsync();
    this.status = JUDGE_MODE_STATES.RUNNING;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return this.runToken;
  }

  awaitOwnerAction(token) {
    if (!this.isCurrent(token) || this.status !== JUDGE_MODE_STATES.RUNNING) return false;
    this.status = JUDGE_MODE_STATES.AWAITING_OWNER_ACTION;
    this._emit();
    return true;
  }

  resumeFromOwnerAction(token) {
    if (!this.isCurrent(token) || this.status !== JUDGE_MODE_STATES.AWAITING_OWNER_ACTION) return false;
    this.status = JUDGE_MODE_STATES.RUNNING;
    this._emit();
    return true;
  }

  complete(token) {
    if (!this.isCurrent(token) || ![JUDGE_MODE_STATES.RUNNING, JUDGE_MODE_STATES.AWAITING_OWNER_ACTION].includes(this.status)) return false;
    this.clearAsync();
    this.status = JUDGE_MODE_STATES.COMPLETE;
    this._emit();
    return true;
  }

  fail(error, token = this.runToken) {
    if (!this.isCurrent(token)) return false;
    this.clearAsync();
    this.status = JUDGE_MODE_STATES.ERROR;
    this.errorMessage = error instanceof Error ? error.message : String(error || 'Unexpected Judge Mode error.');
    this._emit();
    return true;
  }

  next() {
    if (!this.snapshot().canNext || this.scenarioIndex >= this.scenarioCount - 1) return false;
    this.clearAsync();
    this.scenarioIndex += 1;
    this.status = JUDGE_MODE_STATES.READY;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return true;
  }

  previous() {
    if (!this.snapshot().canPrevious) return false;
    this.clearAsync();
    this.scenarioIndex -= 1;
    this.status = JUDGE_MODE_STATES.READY;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return true;
  }

  restartScenario() {
    if (!this.isOpen || this.status === JUDGE_MODE_STATES.RUNNING) return false;
    this.clearAsync();
    this.status = JUDGE_MODE_STATES.READY;
    this.errorMessage = null;
    this.runToken += 1;
    this._emit();
    return true;
  }

  isCurrent(token) {
    return this.isOpen && token === this.runToken;
  }

  schedule(callback, delayMs, token = this.runToken) {
    let timerId;
    timerId = this.setTimeoutFn(() => {
      this.timeouts.delete(timerId);
      if (this.isCurrent(token)) callback();
    }, Math.max(0, delayMs));
    this.timeouts.add(timerId);
    this._emit();
    return timerId;
  }

  every(callback, intervalMs, token = this.runToken) {
    const timerId = this.setIntervalFn(() => {
      if (this.isCurrent(token)) callback();
    }, Math.max(1, intervalMs));
    this.intervals.add(timerId);
    this._emit();
    return timerId;
  }

  clearAsync() {
    for (const timerId of this.timeouts) this.clearTimeoutFn(timerId);
    for (const timerId of this.intervals) this.clearIntervalFn(timerId);
    this.timeouts.clear();
    this.intervals.clear();
  }
}

export function deriveDecisionPipeline(result, authorisationEvent = null) {
  if (!result || !result.decision) return [];
  const decision = result.decision;
  const failed = decision === 'BLOCK';
  const held = ['HOLD', 'REQUIRE_APPROVAL'].includes(decision);
  const invalidated = decision === 'INVALIDATE';
  const approved = decision === 'APPROVE';
  const authorisationDecision = authorisationEvent?.decision ?? (approved || invalidated ? 'HOLD' : decision);

  return clone([
    { key: 'intent', label: 'INTENT RECEIVED', status: 'passed', detail: result.intent?.id ?? 'Recorded intent' },
    {
      key: 'policy', label: 'POLICY EVALUATION',
      status: failed ? 'failed' : held ? 'hold' : 'passed',
      detail: failed ? result.ruleChecked : `${result.rulesEvaluated?.length ?? 0} recorded checks`,
    },
    {
      key: 'authorisation',
      label: failed ? 'BLOCKED' : authorisationDecision === 'REQUIRE_APPROVAL' ? 'APPROVAL REQUIRED' : 'AUTHORISED',
      status: failed ? 'failed' : held ? 'hold' : 'passed',
      detail: authorisationEvent?.reason ?? result.reason,
    },
    {
      key: 'settlement',
      label: invalidated ? 'INVALIDATION' : approved ? 'FINAL REVALIDATION' : 'SETTLEMENT',
      status: invalidated ? 'failed' : approved ? 'passed' : decision === 'HOLD' ? 'hold' : 'idle',
      detail: invalidated ? 'INVALIDATED · ₹0 moved' : approved ? 'SETTLED' : decision === 'HOLD' ? 'PENDING_SETTLEMENT' : 'Not reached',
    },
  ]);
}

export function extractRuleTrace(result) {
  return clone((result?.rulesEvaluated ?? []).map(({ rule, passed, reason }) => ({ rule, passed: Boolean(passed), reason })));
}

export function extractLedgerEvidence(ledger, selectedIndex = -1) {
  if (!Array.isArray(ledger) || ledger.length === 0) return null;
  const resolvedIndex = selectedIndex < 0 ? ledger.length - 1 : Math.min(selectedIndex, ledger.length - 1);
  const event = ledger[resolvedIndex];
  const rule = event.rulesEvaluated?.find(item => !item.passed) ?? event.rulesEvaluated?.at(-1) ?? null;
  return clone({
    ledgerEventCount: ledger.length,
    selectedEventId: event.id,
    intentId: event.intent?.id ?? 'N/A',
    policyVersion: event.policyVersion,
    policyLabel: event.policyLabel,
    rule: rule?.rule ?? event.ruleChecked,
    ownerAction: event.ownerAction ?? 'NONE',
    finalStatus: event.finalSettlementStatus,
    fundsMoved: event.fundsMoved,
    decision: event.decision,
    reason: event.reason,
    rulesEvaluated: event.rulesEvaluated ?? [],
    riskState: event.riskState,
    riskScore: event.riskScore,
    timestamp: event.timestamp,
    event,
  });
}
