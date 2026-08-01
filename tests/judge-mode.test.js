import test from 'node:test';
import assert from 'node:assert/strict';

import { AegisPolicyEngine, DEFAULT_POLICY } from '../public/policy-engine.js';
import {
  JUDGE_MODE_STATES,
  JudgeModeStateMachine,
  deriveDecisionPipeline,
  extractLedgerEvidence,
  extractRuleTrace,
} from '../public/judge-mode.js';

function fakeScheduler() {
  let sequence = 0;
  const timeouts = new Map();
  const intervals = new Map();
  return {
    timeouts,
    intervals,
    setTimeoutFn(callback) { const id = ++sequence; timeouts.set(id, callback); return id; },
    clearTimeoutFn(id) { timeouts.delete(id); },
    setIntervalFn(callback) { const id = ++sequence; intervals.set(id, callback); return id; },
    clearIntervalFn(id) { intervals.delete(id); },
  };
}

function machine() {
  const scheduler = fakeScheduler();
  return {
    scheduler,
    instance: new JudgeModeStateMachine({ scenarioCount: 6, ...scheduler }),
  };
}

function engineIntent(engine, id = 'JUDGE-INTENT') {
  return {
    id,
    agentId: engine.policy.authorisedAgentId,
    taskId: engine.policy.taskId,
    amount: 1_200,
    recipient: 'CloudGrid',
    category: engine.policy.approvedCategory,
    requestedAt: '2026-08-01T10:00:00.000Z',
    expiresAt: engine.policy.expiresAt,
    policyVersion: engine.policy.version,
    nonce: `NONCE-${id}`,
    status: 'REQUESTED',
  };
}

test('Judge Mode opens in READY at scenario one', () => {
  const { instance } = machine();
  const snapshot = instance.open();
  assert.equal(snapshot.status, JUDGE_MODE_STATES.READY);
  assert.equal(snapshot.scenarioIndex, 0);
  assert.equal(snapshot.canStart, true);
});

test('a Judge scenario cannot be double-executed', () => {
  const { instance } = machine();
  instance.open();
  const firstToken = instance.start();
  const secondToken = instance.start();
  assert.equal(typeof firstToken, 'number');
  assert.equal(secondToken, null);
  assert.equal(instance.snapshot().status, JUDGE_MODE_STATES.RUNNING);
});

test('RUNNING and AWAITING_OWNER_ACTION disable conflicting navigation', () => {
  const { instance } = machine();
  instance.open();
  const token = instance.start();
  assert.equal(instance.snapshot().canPrevious, false);
  assert.equal(instance.snapshot().canNext, false);
  assert.equal(instance.awaitOwnerAction(token), true);
  assert.equal(instance.snapshot().awaitingOwnerAction, true);
  assert.equal(instance.previous(), false);
});

test('decision pipeline and rule trace use the canonical engine result', () => {
  const engine = new AegisPolicyEngine({ initialRuntime: { taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 } });
  const result = engine.processIntent(engineIntent(engine));
  const authorisation = engine.getLedger().find(event => event.intent?.id === result.intent.id && event.eventType === 'AUTHORISATION');
  const pipeline = deriveDecisionPipeline(result, authorisation);
  const trace = extractRuleTrace(result);
  assert.equal(pipeline.at(-1).detail, 'SETTLED');
  assert.equal(pipeline.at(-1).status, 'passed');
  assert.deepEqual(trace, result.rulesEvaluated);
});

test('Scenario 5 remains pending until a manual owner action or settlement', () => {
  const { instance } = machine();
  instance.open();
  const token = instance.start();
  instance.awaitOwnerAction(token);
  assert.equal(instance.snapshot().status, JUDGE_MODE_STATES.AWAITING_OWNER_ACTION);
  assert.equal(instance.snapshot().canNext, false);
  assert.equal(instance.snapshot().canRestart, true);
});

test('a pending Judge intent can settle when the owner does not freeze it', () => {
  const engine = new AegisPolicyEngine({ initialRuntime: { taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 } });
  const pending = engine.authoriseIntent({ ...engineIntent(engine, 'JUDGE-SETTLE'), amount: 1_000 });
  const settled = engine.settleIntent(pending.intent.id);
  assert.equal(pending.decision, 'HOLD');
  assert.equal(settled.decision, 'APPROVE');
  assert.equal(settled.fundsMoved, 1_000);
});

test('manual owner freeze invalidates the pending Judge intent', () => {
  const engine = new AegisPolicyEngine({ initialRuntime: { taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 } });
  const pending = engine.authoriseIntent({ ...engineIntent(engine, 'JUDGE-FREEZE'), amount: 1_000 });
  const frozen = engine.freezeAgent({ ownerId: DEFAULT_POLICY.ownerId, timestamp: '2026-08-01T10:00:05.000Z' });
  assert.equal(pending.decision, 'HOLD');
  assert.equal(frozen.decision, 'FREEZE');
  assert.equal(frozen.invalidated.at(-1).decision, 'INVALIDATE');
  assert.equal(frozen.invalidated.at(-1).fundsMoved, 0);
});

test('closing Judge Mode clears every owned timer', () => {
  const { instance, scheduler } = machine();
  instance.open();
  const token = instance.start();
  instance.schedule(() => {}, 1_000, token);
  instance.every(() => {}, 1_000, token);
  assert.equal(instance.snapshot().activeTimerCount, 2);
  instance.close();
  assert.equal(instance.snapshot().activeTimerCount, 0);
  assert.equal(scheduler.timeouts.size, 0);
  assert.equal(scheduler.intervals.size, 0);
});

test('reset clears Judge timers and restores READY deterministically', () => {
  const { instance } = machine();
  instance.open();
  const token = instance.start();
  instance.schedule(() => {}, 1_000, token);
  const reset = instance.reset({ preserveOpen: true });
  assert.equal(reset.status, JUDGE_MODE_STATES.READY);
  assert.equal(reset.scenarioIndex, 0);
  assert.equal(reset.activeTimerCount, 0);
});

test('reopening Judge Mode always starts from the same baseline', () => {
  const { instance } = machine();
  const first = instance.open();
  const token = instance.start();
  instance.complete(token);
  instance.next();
  instance.close();
  const reopened = instance.open();
  assert.equal(reopened.status, first.status);
  assert.equal(reopened.scenarioIndex, first.scenarioIndex);
  assert.equal(reopened.activeTimerCount, 0);
});

test('preparing a scenario produces a clean READY state', () => {
  const { instance, scheduler } = machine();
  instance.open();
  const token = instance.start();
  instance.schedule(() => {}, 100, token);
  assert.equal(instance.prepareScenario(4), true);
  assert.equal(instance.snapshot().scenarioIndex, 4);
  assert.equal(instance.snapshot().status, JUDGE_MODE_STATES.READY);
  assert.equal(instance.snapshot().activeTimerCount, 0);
  assert.equal(scheduler.timeouts.size, 0);
});

test('Scenario 6 evidence is extracted from the actual ledger event', () => {
  const engine = new AegisPolicyEngine({ initialRuntime: { taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 } });
  engine.processIntent(engineIntent(engine, 'LEDGER-PROOF'));
  const ledger = engine.getLedger();
  const evidence = extractLedgerEvidence(ledger);
  assert.equal(evidence.ledgerEventCount, ledger.length);
  assert.equal(evidence.selectedEventId, ledger.at(-1).id);
  assert.equal(evidence.intentId, 'LEDGER-PROOF');
  assert.equal(evidence.finalStatus, 'SETTLED');
  assert.equal(evidence.fundsMoved, 1_200);
  assert.deepEqual(evidence.rulesEvaluated, ledger.at(-1).rulesEvaluated);
});
