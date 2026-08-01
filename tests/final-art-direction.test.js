import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { AegisPolicyEngine } from '../public/policy-engine.js';
import { createCoreVisualState } from '../public/visual-state.js';

const read = path => readFile(new URL(path, import.meta.url));
const text = async path => (await read(path)).toString('utf8');
const digest = value => createHash('sha256').update(value).digest('hex');

const [html, css, app, rings, packageJson, proof] = await Promise.all([
  text('../public/index.html'),
  text('../public/styles.css'),
  text('../public/app.js'),
  text('../public/aegis-rings.js'),
  text('../package.json'),
  text('../public/contract-proof.json').then(JSON.parse),
]);

test('73. WebGL enhancement retains a complete failure fallback', () => {
  assert.match(html, /signature-core-svg/);
  assert.match(rings, /if \(!gl\)[\s\S]*rendererState = 'fallback'/);
  assert.match(rings, /catch \(error\)[\s\S]*rendererState = 'fallback'/);
});

test('74. reduced-motion and mobile paths use the static Aegis Core', () => {
  assert.match(rings, /reducedMotion\.matches/);
  assert.match(rings, /window\.innerWidth < 768/);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]*\.magic-rings-mount\{display:none!important\}/);
});

test('75. public runtime has no remote visual or font assets', () => {
  const runtimeAssets = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(runtimeAssets.length > 0);
  assert.ok(runtimeAssets.every(asset => asset.startsWith('./') || asset.startsWith('#')));
  assert.doesNotMatch(css, /@import|https?:\/\//i);
});

test('76. rejected face, webcam, and OGL implementations are absent', () => {
  const runtime = `${html}\n${app}\n${rings}\n${packageJson}`;
  assert.doesNotMatch(runtime, /face-api|getUserMedia|mediaDevices|from ['"]ogl|\bparticles?\b/i);
});

test('77. exactly one progressively enhanced ring scene is declared', () => {
  assert.equal((html.match(/id="magicRingsMount"/g) || []).length, 1);
  assert.equal((html.match(/src="\.\/aegis-rings\.js"/g) || []).length, 1);
  assert.match(rings, /sceneCount: 1/);
});

test('78. the single enhancement pauses off-screen and releases resources', () => {
  assert.match(rings, /IntersectionObserver/);
  assert.match(rings, /else cancelAnimationFrame\(frame\)/);
  assert.match(rings, /gl\.deleteBuffer\(buffer\)/);
  assert.match(rings, /gl\.deleteProgram\(program\)/);
  assert.match(rings, /pagehide/);
});

test('79. critical typography tokens meet the presentation minimums', () => {
  assert.match(css, /--font-caption:13px/);
  assert.match(css, /--font-label:14px/);
  assert.match(css, /--font-body:17px/);
  assert.match(css, /--font-display:clamp\(54px,5\.35vw,76px\)/);
  assert.doesNotMatch(css, /\.legal\{[^}]*font-size:(?:[0-9]|1[01])px/);
});

test('80. the five research chapters replace the disconnected feature-card story', () => {
  for (const id of ['thesis', 'authority', 'intervention', 'proof', 'control-centre']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(css, /\.feature-proof,[^\n]*display:none!important/);
});

test('81. Judge Mode keeps its action reachable and mobile composition flat', () => {
  assert.match(css, /\.judge-foot\{position:sticky;bottom:0/);
  assert.match(css, /max-width:767px[\s\S]*\.judge-body\{display:block;overflow-y:auto;overflow-x:hidden\}/);
  assert.match(html, /id="judgeNext"/);
});

test('82. responsive composition explicitly prevents sideways overflow', () => {
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /@media\(max-width:767px\)/);
  assert.match(css, /\.section-shell\{width:min\(100% - 34px,680px\)\}/);
});

test('83. intervention output is still derived from an exact engine result', () => {
  const engine = new AegisPolicyEngine({ clock: () => '2026-08-01T10:00:00.000Z' });
  const result = engine.processIntent({
    id: 'ART-DIRECTION-BLOCK',
    agentId: engine.policy.authorisedAgentId,
    taskId: engine.policy.taskId,
    amount: 8_500,
    recipient: 'CloudGrid',
    category: engine.policy.approvedCategory,
    requestedAt: '2026-08-01T10:00:00.000Z',
    expiresAt: engine.policy.expiresAt,
    policyVersion: engine.policy.version,
    nonce: 'ART-DIRECTION-BLOCK',
    status: 'REQUESTED',
  });
  const visual = createCoreVisualState(result);
  assert.equal(result.decision, 'BLOCK');
  assert.equal(visual.walletReachable, false);
  assert.match(app, /createCoreVisualState\(result, snapshot\.risk\.state\)/);
  assert.match(app, /result\.ruleChecked/);
  assert.match(app, /result\.fundsMoved/);
});

test('84. overview proof outcomes stay empty until engine evidence exists', () => {
  assert.match(html, /id="proofTwinV1">AWAITING REPLAY/);
  assert.match(html, /id="proofEventRule">NO RECORDED EVENT/);
  assert.match(app, /proofTwinV1[^\n]*model\.legacyBypassed/);
  assert.match(app, /event\?\.ruleChecked/);
});

test('85. contract proof remains truthful and locally scoped', () => {
  assert.equal(proof.environment, 'LOCAL_EVM');
  assert.equal(proof.deploymentStatus, 'NOT_PUBLICLY_DEPLOYED');
  assert.equal(proof.realFundsMoved, false);
  assert.equal(proof.contractTests.failed, 0);
  assert.equal(proof.attackVectors.parity, 'PASS');
});

test('86. critical source and pre-existing test hashes remain locked', async () => {
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
    ['./cinematic-visual.test.js', 'a37a9224e243e82e84ce2c09b0c60b4df5c8465bf48a89af5b70f17b107b00c4'],
    ['../contracts/test/AegisPolicyWallet.test.js', '479481213b109fbc33614b7cdeacffd16db5eaa602c7357a141c0ee2d4421e23'],
  ]);
  for (const [path, hash] of expected) assert.equal(digest(await read(path)), hash, path);
});

test('87. browser capture audits fresh console errors and exact proof state', () => {
  assert.match(app, /localCaptureErrors/);
  assert.match(app, /consoleErrors: \[\.\.\.localCaptureErrors\]/);
  assert.match(html, /data-contract-field="funds">FALSE/);
});

test('88. visual motion remains causal and bounded', () => {
  assert.match(css, /#storyFlow\[data-scan-active="true"\]/);
  assert.match(app, /surface\.dataset\.scanActive = 'true'/);
  assert.match(app, /surface\.dataset\.scanActive = 'false'/);
  assert.doesNotMatch(css, /cursor-trail|screen-shake|confetti|particle/i);
});
