import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import {
  AegisPolicyEngine,
  RULES,
  runPolicyDigitalTwin,
} from '../public/policy-engine.js';
import {
  coreLayerForRule,
  createCoreVisualState,
  createEvasionClusterModel,
  createIncidentStages,
  createTwinReplayModel,
  visualStateForRisk,
} from '../public/visual-state.js';

const [html, css, app, engineSource, judgeSource, engineTests, judgeTests] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/policy-engine.js', import.meta.url)),
  readFile(new URL('../public/judge-mode.js', import.meta.url)),
  readFile(new URL('./policy-engine.test.js', import.meta.url)),
  readFile(new URL('./judge-mode.test.js', import.meta.url)),
]);

const digest = value => createHash('sha256').update(value).digest('hex');

function engine() {
  return new AegisPolicyEngine({
    initialRuntime: { taskSpent: 0, dailySpent: 0, approvedCount: 0, blockedCount: 0, protectedValue: 0 },
    clock: () => '2026-08-01T10:00:00.000Z',
  });
}

function intent(instance, overrides = {}) {
  const id = overrides.id ?? 'VISUAL-INTENT';
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

test('33. Aegis Core approved state follows the canonical engine result', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance));
  const visual = createCoreVisualState(result);
  assert.equal(result.decision, 'APPROVE');
  assert.equal(visual.flow, 'approved');
  assert.equal(visual.walletReachable, true);
  assert.ok(Object.values(visual.rings).every(status => status === 'passed'));
});

test('34. exact failing ring is selected from the decisive engine rule', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance, { id: 'OVER-CAP', nonce: 'OVER-CAP', amount: 8_500 }));
  const visual = createCoreVisualState(result);
  assert.equal(result.ruleChecked, RULES.PER_TRANSACTION_LIMIT);
  assert.equal(coreLayerForRule(result.ruleChecked), 'limits');
  assert.equal(visual.failingLayer, 'limits');
  assert.equal(visual.rings.limits, 'failed');
});

test('35. approved visual path reaches the wallet and blocked path stops at Core', () => {
  const instance = engine();
  const approved = createCoreVisualState(instance.processIntent(intent(instance, { id: 'PASS', nonce: 'PASS' })));
  const blocked = createCoreVisualState(instance.processIntent(intent(instance, { id: 'FAIL', nonce: 'FAIL', recipient: 'Unknown' })));
  assert.equal(approved.walletReachable, true);
  assert.equal(blocked.flow, 'blocked');
  assert.equal(blocked.walletReachable, false);
  assert.equal(blocked.failingLayer, 'intent');
});

test('36. invalidated pending intent never reaches the wallet', () => {
  const instance = engine();
  const pending = instance.authoriseIntent(intent(instance, { id: 'PENDING', nonce: 'PENDING' }));
  const frozen = instance.freezeAgent({ ownerId: instance.policy.ownerId, timestamp: '2026-08-01T10:00:05.000Z' });
  const invalidated = frozen.invalidated.find(event => event.intent.id === pending.intent.id);
  const visual = createCoreVisualState(invalidated);
  assert.equal(invalidated.decision, 'INVALIDATE');
  assert.equal(visual.flow, 'invalidated');
  assert.equal(visual.walletReachable, false);
  assert.equal(visual.walletGate, 'closed');
});

test('37. global visual state contract exactly maps canonical risk states', () => {
  assert.deepEqual(
    ['NORMAL', 'CAUTION', 'RESTRICTED', 'QUARANTINED', 'FROZEN'].map(visualStateForRisk),
    ['normal', 'caution', 'restricted', 'quarantined', 'frozen'],
  );
  assert.match(app, /applyGlobalVisualState\(risk\.state\)/);
});

test('38. frozen result locks all Core rings and financial paths', () => {
  const instance = engine();
  const frozen = instance.freezeAgent({ ownerId: instance.policy.ownerId, timestamp: '2026-08-01T10:00:01.000Z' });
  const visual = createCoreVisualState(frozen.freezeEvent);
  assert.equal(visual.flow, 'frozen');
  assert.equal(visual.walletGate, 'closed');
  assert.ok(Object.values(visual.rings).every(status => status === 'locked'));
});

test('39. kill-switch choreography follows a real owner freeze and invalidation', () => {
  const instance = engine();
  instance.authoriseIntent(intent(instance, { id: 'KILL', nonce: 'KILL' }));
  instance.freezeAgent({ ownerId: instance.policy.ownerId, timestamp: '2026-08-01T10:00:05.000Z' });
  const ledger = instance.getLedger();
  assert.ok(ledger.some(event => event.eventType === 'OWNER_ACTION' && event.decision === 'FREEZE'));
  assert.ok(ledger.some(event => event.decision === 'INVALIDATE' && event.fundsMoved === 0));
  assert.match(app, /performOwnerFreeze\(\{ present: false \}\)/);
  assert.match(app, /kill-choreography/);
});

test('40. Evasion cluster is calculated from the actual transaction group', () => {
  const instance = engine();
  const intents = [0, 3, 7, 11].map((seconds, index) => intent(instance, {
    id: `CLUSTER-${index + 1}`,
    nonce: `CLUSTER-${index + 1}`,
    amount: 1_999,
    requestedAt: `2026-08-01T10:00:${String(seconds).padStart(2, '0')}.000Z`,
  }));
  const result = instance.processIntentBatch(intents, { incidentId: 'VISUAL-CLUSTER' }).at(-1);
  const model = createEvasionClusterModel(intents, result);
  assert.equal(model.intents.length, 4);
  assert.equal(model.total, 7_996);
  assert.equal(model.windowSeconds, 11);
  assert.equal(model.decisiveRule, RULES.EVASION_SHIELD);
  assert.equal(model.fundsMoved, 0);
});

test('41. synchronized Policy Twin comparison remains engine-derived', () => {
  const result = runPolicyDigitalTwin();
  const replay = createTwinReplayModel(result);
  assert.equal(replay.stages.length, 6);
  assert.equal(replay.legacyBypassed, result.legacy.attacksSucceeded);
  assert.equal(replay.hardenedBypassed, result.hardened.attacksSucceeded);
  assert.equal(replay.legacyBypassed, 4);
  assert.equal(replay.hardenedBypassed, 0);
});

test('42. forensic scrubber resolves only actual ledger evidence', () => {
  const instance = engine();
  instance.processIntent(intent(instance, { id: 'LEDGER-PASS', nonce: 'LEDGER-PASS' }));
  instance.processIntent(intent(instance, { id: 'LEDGER-FAIL', nonce: 'LEDGER-FAIL', amount: 8_500 }));
  const stages = createIncidentStages(instance.getLedger());
  assert.equal(stages.find(stage => stage.id === 'valid-payment').event.intent.id, 'LEDGER-PASS');
  assert.equal(stages.find(stage => stage.id === 'policy-violation').event.intent.id, 'LEDGER-FAIL');
  assert.equal(stages.find(stage => stage.id === 'owner-freeze').available, false);
});

test('43. reduced-motion mode removes choreography without changing result classes', () => {
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /judge-card\.kill-choreography \.invalidated-seal\{opacity:1/);
  assert.match(html, /data-flow="idle" data-risk="normal" data-fail-layer="none"/);
});

test('44. signature layouts define bounded responsive overflow behaviour', () => {
  assert.match(css, /max-width:430px/);
  assert.match(css, /max-width:760px/);
  assert.match(css, /max-width:1024px/);
  assert.match(css, /judge-card\{width:calc\(100vw - 12px\)/);
  assert.match(css, /overflow-x:hidden/);
});

test('45. signature pass adds no external font, canvas, WebGL, or runtime dependency', () => {
  assert.doesNotMatch(html, /fonts\.googleapis|<canvas|webgl/i);
  assert.doesNotMatch(app, /requestAnimationFrame\([^)]*=>[^)]*requestAnimationFrame/s);
  assert.match(html, /signature-core-svg/);
});

test('46. locked engine, Judge runtime, and existing tests retain baseline hashes', () => {
  assert.equal(digest(engineSource), '94bc4c66bd696dda7ff7fcffa36507d2d440a82851bb9f49d109a5fccf9f1a6a');
  assert.equal(digest(judgeSource), 'c921b0a263788bba368032742865f88142b2fbf2bc4489ca57c83c0b9efe2bc5');
  assert.equal(digest(engineTests), 'fde0231b82d72a15071341843d679cdb939133101ace2e46fb6841c8ed1f2861');
  assert.equal(digest(judgeTests), 'c7881852480f7393ef75040d3a2a23ffb0ffd0b5702a6a9ed8b37b029a0c03e2');
});

test('47. public markup exposes the four named Core layers and evidence surfaces', () => {
  for (const layer of ['IDENTITY', 'TASK INTENT', 'LIMITS', 'BEHAVIOUR RISK']) assert.ok(html.includes(layer));
  assert.match(html, /id="incidentScrubber"/);
  assert.match(html, /id="v1Replay"/);
  assert.match(html, /id="v2Replay"/);
  assert.match(html, /id="clusterCanvas"/);
});
