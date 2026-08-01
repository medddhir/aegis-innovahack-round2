import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AegisPolicyEngine } from '../public/policy-engine.js';
import { createCoreVisualState } from '../public/visual-state.js';

const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const [html, css, app, proof] = await Promise.all([
  read('../public/index.html'),
  read('../public/styles.css'),
  read('../public/app.js'),
  read('../public/contract-proof.json').then(JSON.parse),
]);
const sprintCss = css.split('/* Sprint 6:')[1] ?? '';
const depthSource = app.slice(app.indexOf('function initDepthPresentation'), app.indexOf('function initInteractions'));

function engine() {
  return new AegisPolicyEngine({ clock: () => '2026-08-01T10:00:00.000Z' });
}

function intent(instance, overrides = {}) {
  const id = overrides.id ?? 'CINEMATIC-INTENT';
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

test('53. projector typography tokens enforce the critical minimum scale', () => {
  assert.match(sprintCss, /--font-caption:12px/);
  assert.match(sprintCss, /--font-label:13px/);
  assert.match(sprintCss, /--font-body:16px/);
  assert.match(sprintCss, /--font-body-large:17px/);
  assert.match(sprintCss, /\.judge-live-meta b[^}]*font-size:14px/);
  assert.match(sprintCss, /footer p,\.legal\{font-size:13px/);
});

test('54. readable secondary-copy colours use explicit high-contrast tokens', () => {
  assert.match(sprintCss, /--text-secondary:#aebdca/);
  assert.match(sprintCss, /--text-tertiary:#91a4b6/);
  assert.match(sprintCss, /hero-sub[^}]*color:var\(--text-secondary\)/);
});

test('55. both Aegis Core instances expose four rings and a foreground shield plane', () => {
  for (const plane of ['1', '2', '3', '4', '5']) assert.ok(html.includes(`data-depth-plane="${plane}"`));
  assert.equal((html.match(/class="signature-core(?:\s|\")/g) ?? []).length, 2);
  assert.equal((html.match(/class="core-strands"/g) ?? []).length, 2);
});

test('56. pointer tilt is bounded to five degrees without an animation loop', () => {
  assert.match(app, /\(-y \* 5\)\.toFixed\(2\)/);
  assert.match(app, /\(x \* 5\)\.toFixed\(2\)/);
  assert.match(app, /Math\.max\(-1, Math\.min\(1/);
  assert.doesNotMatch(depthSource, /requestAnimationFrame/);
});

test('57. pointer tilt is disabled for coarse pointers and sub-768px layouts', () => {
  assert.match(app, /matchMedia\('\(pointer: fine\)'\)/);
  assert.match(app, /window\.innerWidth >= 768/);
  assert.match(sprintCss, /@media \(max-width:767px\)/);
  assert.match(sprintCss, /@media \(pointer:coarse\)/);
});

test('58. reduced motion removes tilt, strands, Lightfall and Glyph motion', () => {
  assert.match(sprintCss, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(sprintCss, /\.signature-core\[data-tilt-active="true"\][^}]*transition:none!important/);
  assert.match(sprintCss, /\.contract-lightfall i,\.glyph-matrix\{animation:none!important\}/);
});

test('59. approved engine output remains the only authority for wallet reachability', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance));
  const visual = createCoreVisualState(result);
  assert.equal(result.decision, 'APPROVE');
  assert.equal(visual.flow, 'approved');
  assert.equal(visual.walletReachable, true);
});

test('60. blocked engine output cannot reach the protected wallet', () => {
  const instance = engine();
  const result = instance.processIntent(intent(instance, { id: 'BLOCKED', nonce: 'BLOCKED', amount: 8_500 }));
  const visual = createCoreVisualState(result);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(visual.walletReachable, false);
  assert.match(sprintCss, /\[data-wallet-gate="closed"\] \.vault-door/);
});

test('61. invalidated pending intent closes the gate with zero funds moved', () => {
  const instance = engine();
  instance.authoriseIntent(intent(instance, { id: 'PENDING-VISUAL', nonce: 'PENDING-VISUAL' }));
  const freeze = instance.freezeAgent({ ownerId: instance.policy.ownerId, timestamp: '2026-08-01T10:00:05.000Z' });
  const invalidated = freeze.invalidated.at(0);
  assert.equal(invalidated.fundsMoved, 0);
  assert.equal(createCoreVisualState(invalidated).walletReachable, false);
  assert.match(sprintCss, /INVALIDATED · NOT REACHED/);
});

test('62. frozen visual state locks the vault and states revoked authority in text', () => {
  const instance = engine();
  const freeze = instance.freezeAgent({ ownerId: instance.policy.ownerId, timestamp: '2026-08-01T10:00:05.000Z' });
  assert.equal(createCoreVisualState(freeze.freezeEvent).walletGate, 'closed');
  assert.match(sprintCss, /FINANCIAL AUTHORITY REVOKED/);
});

test('63. Core strands activate only during a visible real evaluation state', () => {
  assert.match(sprintCss, /\[data-flow="running"\]\[data-visual-active="true"\] \.core-strands/);
  assert.match(app, /IntersectionObserver/);
  assert.match(app, /entry\.target\.dataset\.visualActive = String\(entry\.isIntersecting\)/);
  assert.doesNotMatch(sprintCss, /\n\.core-strands i\{[^}]*animation:/);
});

test('64. Glyph Matrix is a single contained semantic background', () => {
  assert.equal((html.match(/class="glyph-matrix"/g) ?? []).length, 1);
  for (const glyph of ['PASS', 'FAIL', 'V4', 'V5']) assert.ok(html.includes(glyph));
  assert.match(sprintCss, /\.glyph-matrix-host\{[^}]*overflow:hidden/);
  assert.match(sprintCss, /\.glyph-matrix\{[^}]*opacity:\.032/);
});

test('65. Lightfall is confined to Contract Proof and follows its visibility', () => {
  assert.equal((html.match(/class="contract-lightfall"/g) ?? []).length, 1);
  assert.match(html, /contract-enforcement[\s\S]*contract-lightfall/);
  assert.match(sprintCss, /\.contract-enforcement\[data-visual-active="true"\] \.contract-lightfall i/);
});

test('66. final Border Glow selectors are limited to the three approved targets', () => {
  const glowBlock = sprintCss.slice(sprintCss.indexOf('/* Border glow discipline'), sprintCss.indexOf('@keyframes strandSignal'));
  assert.match(glowBlock, /\.judge-card:has/);
  assert.match(glowBlock, /\.judge-contract-proof\[open\] summary/);
  assert.match(glowBlock, /awaiting-owner-action\) #judgeNext/);
  assert.doesNotMatch(glowBlock, /metric-card|nav-item|attack-option|\.panel\b/);
});

test('67. responsive fallbacks flatten depth and preserve horizontal containment', () => {
  assert.match(css, /body\{[^}]*overflow-x:hidden/);
  assert.match(sprintCss, /transform-style:flat/);
  assert.match(sprintCss, /\.judge-body\{display:grid;grid-template-columns:minmax\(0,1fr\)/);
  assert.match(sprintCss, /\.contract-proof-strip strong\.mono\{font-size:12px\}/);
});

test('68. cinematic layer adds no external font, canvas, WebGL or dependency hook', () => {
  assert.doesNotMatch(html, /<canvas|fonts\.googleapis|fonts\.gstatic/i);
  assert.doesNotMatch(app, /from ['"][^'"]*(three|webgl|ogl|particle)|new (THREE|WebGL)/i);
  assert.doesNotMatch(css, /cursor-trail|screen-shake|parallax/i);
});

test('69. published Contract Proof remains truthful local-test evidence', () => {
  assert.equal(proof.environment, 'LOCAL_EVM');
  assert.equal(proof.realFundsMoved, false);
  assert.equal(proof.contractTests.failed, 0);
  assert.equal(proof.attackVectors.parity, 'PASS');
  assert.equal(proof.deploymentStatus, 'NOT_PUBLICLY_DEPLOYED');
  assert.equal('publicContractAddress' in proof, false);
});

test('70. all critical engines, contracts and pre-existing tests retain baseline hashes', async () => {
  const expected = new Map([
    ['../public/policy-engine.js', '94bc4c66bd696dda7ff7fcffa36507d2d440a82851bb9f49d109a5fccf9f1a6a'],
    ['../public/judge-mode.js', 'c921b0a263788bba368032742865f88142b2fbf2bc4489ca57c83c0b9efe2bc5'],
    ['../public/visual-state.js', '7906c771ea79f7262d604438a0f0ae173763b730808e01043a09ec700f167473'],
    ['../contracts/src/AegisPolicyWallet.sol', '44aaaccf792364d35ee9410e3a394e81f9409affd1b3fb6871f4c5cb55b5918c'],
    ['../contracts/src/MockINRToken.sol', '8be461866a59d389f3a651a7afee5f8e9a7a1c7617091401f79df51e294daa27'],
    ['./policy-engine.test.js', 'fde0231b82d72a15071341843d679cdb939133101ace2e46fb6841c8ed1f2861'],
    ['./judge-mode.test.js', 'c7881852480f7393ef75040d3a2a23ffb0ffd0b5702a6a9ed8b37b029a0c03e2'],
    ['./visual-system.test.js', '62f8f6621535aa37f82580f1af406c0c2c479b6cd8fc352e6167d4b7523ebb3e'],
    ['./signature-visual.test.js', '15b347faa1c11f1ccc3ee7863518d4a742bbc90e6751c22e5505b0051f8d1d6e'],
    ['./contract-proof.test.js', '3774cae5d3f47f622913416f6c683f529a164eb452776f949da52e1040a8fe1c'],
    ['../contracts/test/AegisPolicyWallet.test.js', '479481213b109fbc33614b7cdeacffd16db5eaa602c7357a141c0ee2d4421e23'],
  ]);
  for (const [path, hash] of expected) assert.equal(digest(await read(path)), hash, path);
});

test('71. presentation data remains wired to canonical results and real ledger evidence', () => {
  assert.match(app, /applyCoreVisualState\(flow, result\)/);
  assert.match(app, /state\.engine\.getLedger\(\)/);
  assert.match(app, /model\.intents\.length/);
  assert.match(app, /createTwinReplayModel\(state\.twinResults\)/);
});

test('72. final markup keeps regulatory truth and semantic outcome channels', () => {
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /SIMULATED FUNDS/);
  assert.match(html, /MOCK \/ TEST FUNDS/);
  assert.ok(html.includes('This prototype uses simulated/test funds. Any production deployment involving real-money movement, custody or operation of a payment system would require applicable regulatory approvals and integration with licensed financial or payment partners.'));
});
