import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AegisPolicyEngine,
  DEFAULT_POLICY,
  RULE_ORDER,
  RULES,
  runPolicyDigitalTwin,
} from '../public/policy-engine.js';

const ZERO_RUNTIME = Object.freeze({
  taskSpent: 0,
  dailySpent: 0,
  approvedCount: 0,
  blockedCount: 0,
  protectedValue: 0,
});

function engine(options = {}) {
  return new AegisPolicyEngine({
    initialRuntime: ZERO_RUNTIME,
    clock: () => '2026-08-01T10:00:00.000Z',
    ...options,
  });
}

function intent(instance, overrides = {}) {
  const id = overrides.id ?? 'INTENT-001';
  return {
    id,
    agentId: instance.policy.authorisedAgentId,
    taskId: instance.policy.taskId,
    amount: 1_200,
    recipient: 'CloudGrid',
    category: instance.policy.approvedCategory,
    requestedAt: '2026-08-01T10:00:00.000Z',
    expiresAt: instance.policy.expiresAt,
    policyVersion: instance.policy.version,
    nonce: `NONCE-${id}`,
    status: 'REQUESTED',
    ...overrides,
  };
}

test('1. approved allowlisted payment passes both settlement phases', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance));

  assert.equal(result.decision, 'APPROVE');
  assert.equal(result.intent.status, 'SETTLED');
  assert.equal(result.fundsMoved, 1_200);
  assert.equal(result.ruleChecked, RULES.FINAL_SETTLEMENT_REVALIDATION);
  assert.deepEqual(result.rulesEvaluated.map(rule => rule.rule), RULE_ORDER);
});

test('2. per-transaction cap blocks an oversized request', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance, { amount: 8_500 }));

  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.ruleChecked, RULES.PER_TRANSACTION_LIMIT);
  assert.match(result.reason, /exceeds.*cap by.*₹6,000/i);
  assert.equal(result.fundsMoved, 0);
});

test('3. an unknown recipient is blocked before amount limits are considered', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance, { recipient: 'UnknownCounterparty', amount: 8_500 }));

  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.ruleChecked, RULES.RECIPIENT_ALLOWLISTED);
  assert.equal(result.rulesEvaluated.at(-1).rule, RULES.RECIPIENT_ALLOWLISTED);
});

test('4. an expired Budget Capsule blocks the intent', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance, {
    requestedAt: '2026-08-03T10:00:00.000Z',
    expiresAt: '2026-08-03T11:00:00.000Z',
  }));

  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.ruleChecked, RULES.CAPSULE_NOT_EXPIRED);
  assert.match(result.reason, /expired/i);
});

test('5. cumulative task budget blocks otherwise valid spend', () => {
  const instance = engine({ initialRuntime: { ...ZERO_RUNTIME, taskSpent: 9_000, dailySpent: 9_000 } });
  const result = instance.processIntent(intent(instance, { amount: 1_500 }));

  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.ruleChecked, RULES.CUMULATIVE_BUDGET);
  assert.match(result.reason, /₹10,500.*₹10,000/i);
});

test('6. a duplicate nonce is blocked deterministically', () => {
  const instance = engine();
  const first = instance.processIntent(intent(instance, { id: 'NONCE-FIRST', amount: 500, nonce: 'ONE-TIME-NONCE' }));
  const duplicate = instance.processIntent(intent(instance, {
    id: 'NONCE-SECOND', amount: 500, nonce: 'ONE-TIME-NONCE', requestedAt: '2026-08-01T10:01:00.000Z',
  }));

  assert.equal(first.decision, 'APPROVE');
  assert.equal(duplicate.decision, 'BLOCK');
  assert.equal(duplicate.ruleChecked, RULES.NONCE_UNIQUE);
  assert.match(duplicate.reason, /NONCE-FIRST/);
});

test('7. Evasion Shield treats 4 × ₹1,999 as one ₹7,996 attempt', () => {
  const instance = engine();
  const intents = Array.from({ length: 4 }, (_, index) => intent(instance, {
    id: `SPLIT-${index + 1}`,
    nonce: `SPLIT-NONCE-${index + 1}`,
    amount: 1_999,
    requestedAt: `2026-08-01T10:00:0${index * 3}.000Z`,
  }));
  const results = instance.processIntentBatch(intents, { incidentId: 'SPLIT-ATTACK' });

  assert.ok(results.every(result => result.decision === 'BLOCK'));
  assert.ok(results.every(result => result.ruleChecked === RULES.EVASION_SHIELD));
  assert.match(results[0].reason, /₹7,996/);
  assert.equal(instance.getLedger().reduce((sum, event) => sum + event.fundsMoved, 0), 0);
});

test('8. repeated blocked behaviour crosses the exact Restricted threshold', () => {
  const instance = engine();
  const oversized = intent(instance, { id: 'RISK-1', nonce: 'RISK-NONCE-1', amount: 8_500 });
  instance.processIntent(oversized, { incidentId: 'RISK-INCIDENT' });
  const retry = instance.processIntent(intent(instance, {
    id: 'RISK-2', nonce: 'RISK-NONCE-2', amount: 900, requestedAt: '2026-08-01T10:00:02.000Z',
  }), { incidentId: 'RISK-INCIDENT' });
  const snapshot = instance.getSnapshot();

  assert.equal(retry.decision, 'BLOCK');
  assert.equal(snapshot.risk.score, 57);
  assert.equal(snapshot.risk.state, 'RESTRICTED');
  assert.equal(snapshot.risk.signals.repeatedBlockedAttempts, 1);
  assert.equal(snapshot.risk.signals.retriesAfterRejection, 1);
  assert.match(snapshot.risk.response, /owner approval/i);

  const governed = instance.authoriseIntent(intent(instance, {
    id: 'RISK-GOVERNED', nonce: 'RISK-NONCE-3', amount: 900,
    recipient: 'ComputeHub', requestedAt: '2026-08-01T10:01:30.000Z',
  }));
  const ownerApproved = instance.approveIntent(governed.intent.id, {
    ownerId: instance.policy.ownerId,
    timestamp: '2026-08-01T10:01:31.000Z',
  });
  assert.equal(governed.decision, 'REQUIRE_APPROVAL');
  assert.equal(governed.ruleChecked, RULES.RISK_GOVERNOR);
  assert.equal(ownerApproved.decision, 'HOLD');
  assert.equal(ownerApproved.settlementDelayMs, 30_000);
});

test('9. a frozen agent cannot submit subsequent requests', () => {
  const instance = engine();
  instance.freezeAgent({ ownerId: instance.policy.ownerId, timestamp: '2026-08-01T10:00:01.000Z' });
  const result = instance.processIntent(intent(instance, {
    id: 'AFTER-FREEZE',
    nonce: 'AFTER-FREEZE-NONCE',
    policyVersion: instance.policy.version,
  }));

  assert.equal(result.decision, 'BLOCK');
  assert.equal(result.ruleChecked, RULES.AGENT_NOT_FROZEN);
  assert.equal(instance.getSnapshot().risk.state, 'FROZEN');
});

test('10. owner freeze invalidates a pending intent with zero funds moved', () => {
  const instance = engine();
  const pending = instance.authoriseIntent(intent(instance, { id: 'PENDING-FREEZE', nonce: 'PENDING-FREEZE-NONCE', amount: 1_500 }));
  const frozen = instance.freezeAgent({ ownerId: instance.policy.ownerId, timestamp: '2026-08-01T10:00:05.000Z' });

  assert.equal(pending.decision, 'HOLD');
  assert.equal(frozen.invalidated.length, 1);
  assert.equal(frozen.invalidated[0].decision, 'INVALIDATE');
  assert.equal(frozen.invalidated[0].finalSettlementStatus, 'INVALIDATED');
  assert.equal(frozen.invalidated[0].fundsMoved, 0);
  assert.equal(instance.getSnapshot().pendingCount, 0);
});

test('11. final settlement revalidation invalidates an intent that expired in flight', () => {
  const instance = engine();
  const pending = instance.authoriseIntent(intent(instance, {
    id: 'IN-FLIGHT-EXPIRY',
    nonce: 'IN-FLIGHT-EXPIRY-NONCE',
    expiresAt: '2026-08-01T10:00:05.000Z',
  }));
  const result = instance.settleIntent(pending.intent.id, '2026-08-01T10:00:10.000Z');

  assert.equal(pending.decision, 'HOLD');
  assert.equal(result.decision, 'INVALIDATE');
  assert.equal(result.ruleChecked, RULES.FINAL_SETTLEMENT_REVALIDATION);
  assert.equal(result.rulesEvaluated.at(-1).passed, false);
  assert.match(result.reason, /expired/i);
  assert.equal(result.fundsMoved, 0);
});

test('12. Policy Digital Twin derives both outcomes from real engine runs', () => {
  const twin = runPolicyDigitalTwin();

  assert.equal(twin.legacy.attacks.length, 6);
  assert.equal(twin.hardened.attacks.length, 6);
  assert.equal(twin.legacy.attacksSucceeded, 4);
  assert.equal(twin.hardened.attacksSucceeded, 0);
  assert.deepEqual(twin.legacy.attacks.map(attack => attack.name), twin.hardened.attacks.map(attack => attack.name));
  assert.ok(twin.legacy.attacks.every(attack => attack.ledger.length > 0));
  assert.ok(twin.hardened.attacks.every(attack => attack.ledger.length > 0));
  assert.equal(twin.hardened.attacks.find(attack => attack.name === 'Threshold splitting').finalDecision, 'BLOCK');
});

test('13. Forensic Ledger records complete transaction and settlement evidence', () => {
  const instance = engine();
  instance.processIntent(intent(instance, { id: 'EVIDENCE', nonce: 'EVIDENCE-NONCE' }));
  const event = instance.getLedger().at(-1);

  for (const field of [
    'intent', 'agent', 'owner', 'activeTask', 'policyVersion', 'rulesEvaluated',
    'riskSignals', 'decision', 'ownerAction', 'finalSettlementStatus', 'fundsMoved', 'timestamp',
  ]) assert.ok(Object.hasOwn(event, field), `missing ledger field ${field}`);
  assert.equal(event.intent.id, 'EVIDENCE');
  assert.equal(event.decision, 'APPROVE');
  assert.equal(event.finalSettlementStatus, 'SETTLED');
  assert.deepEqual(event.rulesEvaluated.map(rule => rule.rule), RULE_ORDER);
  assert.ok(event.rulesEvaluated.every(rule => typeof rule.passed === 'boolean' && rule.reason.length > 0));
});

test('14. reset restores policy, balances, budgets, risk, pending state, nonce state, and ledger', () => {
  const instance = new AegisPolicyEngine({ clock: () => '2026-08-01T10:00:00.000Z' });
  const original = instance.getSnapshot();
  instance.processIntent(intent(instance, { id: 'RESET-MUTATION', nonce: 'RESET-MUTATION-NONCE' }));
  instance.authoriseIntent(intent(instance, { id: 'RESET-PENDING', nonce: 'RESET-PENDING-NONCE', requestedAt: '2026-08-01T10:01:00.000Z' }));
  instance.recordPolicyModificationAttempt({ agentId: 'Procurement-07', timestamp: '2026-08-01T10:01:02.000Z' });
  instance.reset();

  assert.deepEqual(instance.getSnapshot(), original);
  assert.deepEqual(instance.getLedger(), []);
});

test('15. the same scenario after reset produces byte-for-byte deterministic evidence', () => {
  const instance = engine();
  const scenario = () => {
    const result = instance.processIntent(intent(instance, { id: 'REPEATABLE', nonce: 'REPEATABLE-NONCE' }));
    return { result, snapshot: instance.getSnapshot(), ledger: instance.getLedger() };
  };
  const first = scenario();
  instance.reset();
  const second = scenario();

  assert.deepEqual(second, first);
});
