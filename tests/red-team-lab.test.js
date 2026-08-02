import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  RED_TEAM_PRESETS,
  RedTeamSession,
  RULES,
  escapeRedTeamText,
  parseAmountToPaise,
  validatePlainText,
} from '../public/red-team-session.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const [html, css, controller, sessionSource, proof] = await Promise.all([
  read('public/index.html'), read('public/red-team-lab.css'), read('public/red-team-lab.js'), read('public/red-team-session.js'), read('public/contract-proof.json').then(JSON.parse),
]);

test('113. judge may enter an arbitrary paise-safe amount', () => {
  assert.equal(parseAmountToPaise('1234.56'), 123456);
  assert.equal(parseAmountToPaise('1'), 100);
});

test('114. a custom amount below the active cap may be approved', () => {
  const outcome = new RedTeamSession().attempt({ ...RED_TEAM_PRESETS.compliant, amount: '2499.00' });
  assert.equal(outcome.decision, 'APPROVE');
  assert.equal(outcome.fundsMoved, 2499);
});

test('115. a custom amount above the active cap is blocked by the real limit rule', () => {
  const outcome = new RedTeamSession().attempt({ ...RED_TEAM_PRESETS.compliant, amount: '2501.00' });
  assert.equal(outcome.decision, 'BLOCK');
  assert.equal(outcome.ruleChecked, RULES.PER_TRANSACTION_LIMIT);
  assert.equal(outcome.fundsMoved, 0);
});

test('116. preset label never predetermines the canonical result', () => {
  const allowed = new RedTeamSession().attempt({ ...RED_TEAM_PRESETS.compliant, amount: '1.00', presetLabel: 'Oversized Payment' });
  const blocked = new RedTeamSession().attempt({ ...RED_TEAM_PRESETS.oversized, amount: '2501.00', presetLabel: 'Policy-Compliant Payment' });
  assert.equal(allowed.decision, 'APPROVE');
  assert.equal(blocked.decision, 'BLOCK');
});

test('117. custom unknown recipient is blocked by the allowlist rule', () => {
  const outcome = new RedTeamSession().attempt(RED_TEAM_PRESETS.unknown);
  assert.equal(outcome.ruleChecked, RULES.RECIPIENT_ALLOWLISTED);
  assert.equal(outcome.decision, 'BLOCK');
});

test('118. incorrect task is blocked by the Budget Capsule rule', () => {
  const outcome = new RedTeamSession().attempt(RED_TEAM_PRESETS.wrongTask);
  assert.equal(outcome.ruleChecked, RULES.TASK_MATCHES_CAPSULE);
});

test('119. duplicate nonce is blocked even when requests share one incident', () => {
  const outcome = new RedTeamSession().attempt(RED_TEAM_PRESETS.duplicate);
  assert.equal(outcome.decision, 'BLOCK');
  assert.ok(outcome.results.some(result => result.ruleChecked === RULES.NONCE_UNIQUE));
});

test('120. stale policy version is blocked by current-version enforcement', () => {
  const outcome = new RedTeamSession().attempt(RED_TEAM_PRESETS.stale);
  assert.equal(outcome.ruleChecked, RULES.POLICY_VERSION_CURRENT);
});

test('121. split requests use coordinated Evasion Shield evaluation', () => {
  const outcome = new RedTeamSession().attempt(RED_TEAM_PRESETS.splitting);
  assert.equal(outcome.requestCount, 4);
  assert.equal(outcome.combinedAmountPaise, 799600);
  assert.equal(outcome.windowSeconds, 11);
  assert.equal(outcome.ruleChecked, RULES.EVASION_SHIELD);
  assert.equal(outcome.fundsMoved, 0);
});

test('122. owner-activated custom policy changes the canonical outcome', () => {
  const session = new RedTeamSession();
  const before = session.attempt({ ...RED_TEAM_PRESETS.compliant, amount: '4000.00' });
  session.reset();
  const activation = session.activatePolicy({
    agentId: 'Judge-Agent', task: 'Purchase verified compute', taskId: 'JUDGE-COMPUTE',
    perTransactionCap: '5000.00', dailyCumulativeCap: '8000.00', totalTaskBudget: '9000.00',
    approvedRecipients: ['CloudGrid'], expiresAt: '2026-08-02T17:00:00.000Z', settlementDelaySeconds: 5, violationThreshold: 55,
  });
  const after = session.attempt({ ...RED_TEAM_PRESETS.compliant, amount: '4000.00' });
  assert.equal(before.decision, 'BLOCK');
  assert.equal(activation.decision, 'APPROVE');
  assert.equal(after.decision, 'APPROVE');
  assert.equal(after.activePolicyVersion, 5);
});

test('123. pending custom transaction can settle through real final revalidation', () => {
  const session = new RedTeamSession();
  const pending = session.attempt(RED_TEAM_PRESETS.pending);
  const settled = session.settlePending();
  assert.equal(pending.decision, 'HOLD');
  assert.equal(settled.decision, 'APPROVE');
  assert.equal(settled.primary.intent.status, 'SETTLED');
});

test('124. manual owner Kill Switch invalidates a pending custom transaction', () => {
  const session = new RedTeamSession();
  session.attempt(RED_TEAM_PRESETS.pending);
  const invalidated = session.freezePending();
  assert.equal(invalidated.decision, 'INVALIDATE');
  assert.equal(invalidated.primary.intent.status, 'INVALIDATED');
  assert.equal(invalidated.activePolicyVersion, 5);
});

test('125. invalidated custom transaction moves zero funds', () => {
  const session = new RedTeamSession();
  session.attempt(RED_TEAM_PRESETS.pending);
  const invalidated = session.freezePending();
  assert.equal(invalidated.fundsMovedPaise, 0);
  assert.equal(session.getSummary().cumulativeFundsMovedPaise, 0);
});

test('126. session ledger records complete custom intent evidence', () => {
  const session = new RedTeamSession();
  session.attempt({ ...RED_TEAM_PRESETS.unknown, customRecipient: 'Judge Vendor' });
  const event = session.getLedger().at(-1);
  assert.equal(event.intent.recipient, 'Judge Vendor');
  assert.ok(event.rulesEvaluated.length);
  assert.equal(event.simulatedFunds, true);
});

test('127. Reset Lab clears session evidence and summary', () => {
  const session = new RedTeamSession();
  session.attempt(RED_TEAM_PRESETS.oversized);
  session.reset();
  assert.equal(session.getLedger().length, 0);
  assert.equal(session.getSummary().attemptsSubmitted, 0);
  assert.equal(session.lastOutcome, null);
});

test('128. Replay Last Attempt reproduces deterministic decision evidence', () => {
  const session = new RedTeamSession();
  const first = session.attempt(RED_TEAM_PRESETS.splitting);
  const replay = session.replayLast();
  assert.deepEqual(
    { decision: replay.decision, rule: replay.ruleChecked, amount: replay.combinedAmountPaise, moved: replay.fundsMovedPaise },
    { decision: first.decision, rule: first.ruleChecked, amount: first.combinedAmountPaise, moved: first.fundsMovedPaise },
  );
});

test('129. invalid, unsafe and non-finite financial values are rejected', () => {
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.234', '10000001']) assert.throws(() => parseAmountToPaise(value));
});

test('130. custom text rejects executable markup and escapes rendered evidence', () => {
  assert.throws(() => validatePlainText('<script>alert(1)</script>', 'Recipient'));
  assert.throws(() => validatePlainText('javascript:alert(1)', 'Task'));
  assert.equal(escapeRedTeamText('A&B <test>'), 'A&amp;B &lt;test&gt;');
  assert.match(controller, /textContent = event\.intent/);
});

test('131. contract boundary wording remains exact and truthful', () => {
  assert.match(html, /This custom challenge is evaluated live by the deterministic Aegis browser engine\. Core settlement boundaries are independently implemented and verified through the Aegis Policy Wallet local-EVM contract suite\./);
  assert.equal(proof.environment, 'LOCAL_EVM');
  assert.equal(proof.realFundsMoved, false);
});

test('132. mobile primary action remains sticky and all three entry points exist', () => {
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.red-team-foot\{position:sticky/);
  assert.ok((html.match(/data-open-red-team/g) || []).length >= 3);
  assert.match(html, /id="judgeRedTeam"/);
});

test('133. reduced-motion mode preserves state while disabling optional motion', () => {
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /\.red-team-scan:after[\s\S]*animation:none!important/);
  assert.match(controller, /reducedMotion\(\) \? 0 : 140/);
});

test('134. Red Team browser audit reports no console or overflow failures when present', async () => {
  const audit = await read('docs/screenshots/red-team-lab/browser-audit.json').then(JSON.parse).catch(() => ({ captures: [], viewports: [] }));
  for (const item of [...(audit.captures ?? []), ...(audit.viewports ?? [])]) {
    assert.equal(item.horizontalOverflow, 0);
    assert.equal(item.modalOverflow, 0);
    assert.deepEqual(item.consoleErrors, []);
    assert.equal(item.actionReachable, true);
  }
});

test('135. locked engine, Judge, visual-state, Solidity and parity hashes remain unchanged', async () => {
  const expected = {
    'public/policy-engine.js': '94bc4c66bd696dda7ff7fcffa36507d2d440a82851bb9f49d109a5fccf9f1a6a',
    'public/judge-mode.js': 'c921b0a263788bba368032742865f88142b2fbf2bc4489ca57c83c0b9efe2bc5',
    'public/visual-state.js': '7906c771ea79f7262d604438a0f0ae173763b730808e01043a09ec700f167473',
    'contracts/src/AegisPolicyWallet.sol': '44aaaccf792364d35ee9410e3a394e81f9409affd1b3fb6871f4c5cb55b5918c',
    'contracts/src/MockINRToken.sol': '8be461866a59d389f3a651a7afee5f8e9a7a1c7617091401f79df51e294daa27',
    'contracts/test/AegisPolicyWallet.test.js': '479481213b109fbc33614b7cdeacffd16db5eaa602c7357a141c0ee2d4421e23',
    'contracts/test-vectors/aegis-vectors.json': '15644adb8ac263b74f2ed518d056e0fb8c297dc423d138f16ec90f8d799be83c',
  };
  for (const [path, hash] of Object.entries(expected)) assert.equal(digest(await read(path)), hash, path);
});

test('136. public and dist remain byte-identical after build', async () => {
  const { readdir } = await import('node:fs/promises');
  const publicFiles = (await readdir(new URL('public/', root))).sort();
  const distFiles = (await readdir(new URL('dist/', root))).sort();
  assert.deepEqual(distFiles, publicFiles);
  for (const file of publicFiles) assert.equal(digest(await read(`dist/${file}`)), digest(await read(`public/${file}`)), file);
});
