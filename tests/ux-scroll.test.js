import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const read = file => readFile(new URL(file, root), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');

const [html, css, ux, packageJson, copyLock, proof, audit] = await Promise.all([
  read('public/index.html'),
  read('public/ux-scroll.css'),
  read('public/ux-scroll.js'),
  read('package.json').then(JSON.parse),
  read('docs/VISIBLE_COPY_LOCK.json').then(JSON.parse),
  read('public/contract-proof.json').then(JSON.parse),
  read('docs/screenshots/final-ux/browser-audit.json').then(JSON.parse),
]);

const allAudits = [...audit.screenshots, ...audit.viewports];

async function filesBelow(directory) {
  const output = [];
  async function visit(relative) {
    const entries = await readdir(new URL(`${directory}${relative}`, root), { withFileTypes: true });
    for (const entry of entries) {
      const path = `${relative}${entry.name}`;
      if (entry.isDirectory()) await visit(`${path}/`);
      else output.push(path);
    }
  }
  await visit('');
  return output.sort();
}

test('137. the exact visible-copy snapshot remains locked', () => {
  const check = spawnSync(process.execPath, ['scripts/snapshot-visible-copy.mjs', '--check'], { cwd: new URL('.', root), encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.equal(copyLock.global.characters, 14800);
  assert.equal(copyLock.global.sha256, 'e8682750b07863cb484e78a26e129d738e0a6af5cc8eb3ec741770b5d2d98669');
});

test('138. the six locked features remain present without a seventh product feature', () => {
  const features = [
    'Task-Bound Budget Capsules', 'Adaptive Risk Governor', 'Evasion Shield',
    'Two-Phase Settlement', 'Policy Digital Twin', 'Forensic Proof Ledger',
  ];
  for (const feature of features) assert.match(html, new RegExp(feature));
  assert.equal(features.length, 6);
});

test('139. scrolling changes presentation only and cannot call the financial engine', () => {
  assert.doesNotMatch(ux, /processIntent|evaluateCoordinatedIntents|settlePending|freezeAgent|getEngineSnapshot/);
  assert.equal(audit.orchestration.engineStable, true);
});

test('140. fast scrolling writes no ledger event', () => {
  assert.equal(audit.orchestration.ledgerStable, true);
});

test('141. GSAP is the single pinned animation runtime', () => {
  assert.deepEqual(packageJson.dependencies, { gsap: '3.15.0' });
  assert.equal((html.match(/src="\.\/gsap\.min\.js"/g) || []).length, 1);
  assert.equal((html.match(/src="\.\/ScrollTrigger\.min\.js"/g) || []).length, 1);
});

test('142. ScrollTrigger is explicitly registered and controller-scoped', () => {
  assert.match(ux, /gsap\.registerPlugin\(ScrollTrigger\)/);
  assert.match(ux, /gsap\.context\(/);
  assert.match(ux, /gsap\.matchMedia\(\)/);
  assert.match(ux, /ScrollTrigger\.batch\(/);
});

test('143. no Lenis runtime or dependency exists', () => {
  assert.doesNotMatch(`${JSON.stringify(packageJson)}\n${html}\n${ux}`, /\blenis\b/i);
});

test('144. no Locomotive or second scroll runtime exists', () => {
  assert.doesNotMatch(`${JSON.stringify(packageJson)}\n${html}\n${ux}`, /locomotive|scrollsmoother|framer-motion|anime\.js/i);
});

test('145. modal and resize cycles do not duplicate ScrollTriggers', () => {
  assert.equal(audit.orchestration.triggerStable, true);
  assert.equal(audit.orchestration.uniqueTriggerIds, true);
});

test('146. controller destroy removes every owned ScrollTrigger', () => {
  assert.equal(audit.orchestration.destroyed, 0);
  assert.match(ux, /ScrollTrigger\.getAll\(\)\.forEach\(trigger => trigger\.kill\(true\)\)/);
});

test('147. Judge Mode pauses page scroll orchestration', () => {
  assert.equal(audit.orchestration.judgePaused, true);
});

test('148. Red Team Lab pauses page scroll orchestration', () => {
  assert.equal(audit.orchestration.redPaused, true);
});

test('149. closing either full-screen experience restores the page position', () => {
  assert.equal(audit.orchestration.judgeRestored, true);
  assert.equal(audit.orchestration.redRestored, true);
});

test('150. fast scrolling exits pinned stories in a valid state', () => {
  assert.equal(audit.orchestration.pinReleased, true);
  assert.ok(['thesis', 'threat', 'authority', 'intervention', 'control', 'challenge', 'proof', 'system'].includes(audit.orchestration.fastScroll.currentChapter));
});

test('151. all eight chapters have a direct controller destination', () => {
  for (const id of ['thesis', 'threat', 'authority', 'intervention', 'control', 'challenge', 'proof', 'system']) {
    assert.match(ux, new RegExp(`id: '${id}'`));
  }
  assert.match(ux, /scrollIntoView\(\{ behavior: reducedMotion\(\) \? 'auto' : 'smooth'/);
});

test('152. the floating navigation exposes current chapter and reading progress', () => {
  assert.match(ux, /aria-current/);
  assert.match(ux, /currentChapter: state\.currentChapter/);
  assert.match(css, /--ux-progress/);
  assert.equal(audit.screenshots.find(item => item.label === '19-floating-navigation.png')?.currentChapter, 'authority');
});

test('153. mobile creates no pinned or scrubbed story timeline', () => {
  for (const item of audit.viewports.filter(item => item.width < 768 && !item.reduced)) {
    assert.equal(item.pinnedTriggers, 0, item.label);
    assert.equal(item.scrubbedTriggers, 0, item.label);
  }
});

test('154. reduced motion creates no pinned or scrubbed animation', () => {
  const reduced = audit.viewports.find(item => item.reduced);
  assert.ok(reduced);
  assert.equal(reduced.pinnedTriggers, 0);
  assert.equal(reduced.scrubbedTriggers, 0);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
});

test('155. every required viewport has zero horizontal overflow', () => {
  for (const item of audit.viewports) assert.equal(item.horizontalOverflow, 0, item.label);
});

test('156. no critical text is clipped in the browser capture matrix', () => {
  for (const item of allAudits) assert.equal(item.clippedCriticalText, 0, item.label);
});

test('157. Judge and Red Team primary actions remain reachable', () => {
  for (const item of audit.viewports) {
    assert.equal(item.judgeActionReachable, true, item.label);
    assert.equal(item.redActionReachable, true, item.label);
  }
});

test('158. the browser run reports no console errors', () => {
  for (const item of allAudits) assert.deepEqual(item.consoleErrors, [], item.label);
});

test('159. forensic default evidence is concise while complete evidence remains reachable', () => {
  for (const label of ['INTENT', 'POLICY', 'RULE', 'OWNER ACTION', 'FINAL STATUS', 'FUNDS MOVED']) assert.match(ux, new RegExp(`'${label}'`));
  assert.match(ux, /document\.createElement\('details'\)/);
  assert.match(css, /ux-forensic-compact small\{[^}]*12\.5px/);
  assert.match(css, /ux-forensic-compact b\{[^}]*14px/);
});

test('160. scroll orchestration retains native scrolling without wheel interception', () => {
  assert.doesNotMatch(ux, /wheel|preventDefault\(\)|scroll-snap-type/);
  assert.doesNotMatch(css, /scroll-snap-type/);
});

test('161. contract proof remains truthful local-EVM evidence', () => {
  assert.equal(proof.environment, 'LOCAL_EVM');
  assert.equal(proof.realFundsMoved, false);
  assert.equal(proof.deploymentStatus, 'NOT_PUBLICLY_DEPLOYED');
  assert.equal(proof.attackVectors.parity, 'PASS');
  for (const item of allAudits) assert.equal(item.proofTruthful, true, item.label);
});

test('162. all locked policy, Judge, Red Team, Solidity, and vector sources retain their hashes', async () => {
  const expected = {
    'public/policy-engine.js': '94bc4c66bd696dda7ff7fcffa36507d2d440a82851bb9f49d109a5fccf9f1a6a',
    'public/judge-mode.js': 'c921b0a263788bba368032742865f88142b2fbf2bc4489ca57c83c0b9efe2bc5',
    'public/visual-state.js': '7906c771ea79f7262d604438a0f0ae173763b730808e01043a09ec700f167473',
    'public/red-team-lab.js': '24b4bd4f34682a857cc3d5ee17d6913b642c5a93def199460d31c0243294c6d4',
    'contracts/src/AegisPolicyWallet.sol': '44aaaccf792364d35ee9410e3a394e81f9409affd1b3fb6871f4c5cb55b5918c',
    'contracts/src/MockINRToken.sol': '8be461866a59d389f3a651a7afee5f8e9a7a1c7617091401f79df51e294daa27',
    'tests/policy-engine.test.js': 'fde0231b82d72a15071341843d679cdb939133101ace2e46fb6841c8ed1f2861',
    'tests/judge-mode.test.js': 'c7881852480f7393ef75040d3a2a23ffb0ffd0b5702a6a9ed8b37b029a0c03e2',
    'tests/red-team-lab.test.js': '84467f823bdc9b7bc6cbc204ccfad8262656b2cfb743ea3a20686613f2230da7',
    'contracts/test/AegisPolicyWallet.test.js': '479481213b109fbc33614b7cdeacffd16db5eaa602c7357a141c0ee2d4421e23',
    'contracts/test-vectors/aegis-vectors.json': '15644adb8ac263b74f2ed518d056e0fb8c297dc423d138f16ec90f8d799be83c',
  };
  for (const [file, hash] of Object.entries(expected)) assert.equal(digest(await read(file)), hash, file);
});

test('163. public and dist outputs are byte-identical after build', async () => {
  const publicFiles = await filesBelow('public/');
  const distFiles = await filesBelow('dist/');
  assert.deepEqual(distFiles, publicFiles);
  for (const file of publicFiles) {
    const [publicBytes, distBytes] = await Promise.all([
      readFile(new URL(`public/${file}`, root)),
      readFile(new URL(`dist/${file}`, root)),
    ]);
    assert.deepEqual(distBytes, publicBytes, file);
  }
});

test('164. UX runtime assets are local, bounded, and included in the static build', async () => {
  for (const asset of ['public/gsap.min.js', 'public/ScrollTrigger.min.js', 'public/ux-scroll.js', 'public/ux-scroll.css']) {
    const info = await stat(new URL(asset, root));
    assert.ok(info.size > 0, asset);
  }
  assert.doesNotMatch(`${html}\n${css}\n${ux}`, /<script[^>]+https?:|@import\s+url\(https?:|url\(https?:/i);
  assert.match(ux, /preventOverlaps/);
  assert.match(ux, /fastScrollEnd/);
  assert.match(ux, /invalidateOnRefresh/);
});
