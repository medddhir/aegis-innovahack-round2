import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const decode = value => value.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));

const [html, css, blackCss, app, blackJs, rings, proof, matrix, packageJson] = await Promise.all([
  read('public/index.html'), read('public/styles.css'), read('public/black-label.css'), read('public/app.js'),
  read('public/black-label.js'), read('public/aegis-rings.js'), read('public/contract-proof.json').then(JSON.parse),
  read('docs/COMPONENT_USAGE_MATRIX.md'), read('package.json'),
]);

const componentNames = [...html.matchAll(/data-aegis-component="([^"]+)"/g)].map(match => decode(match[1]));
const uniqueComponents = new Set(componentNames);

test('89. all 32 populated library concepts are audited', () => {
  const rows = [...matrix.matchAll(/^\| (\d{2}) \| ([^|]+) \|/gm)];
  assert.equal(rows.length, 32);
  assert.deepEqual(rows.map(row => Number(row[1])), Array.from({ length: 32 }, (_, index) => index + 1));
});

test('90. at least 29 component concepts have visible implementation markers', () => {
  assert.equal(uniqueComponents.size, 32);
  assert.ok(componentNames.length >= 32);
});

test('91. component usage matrix matches the live DOM catalogue', () => {
  for (const name of uniqueComponents) assert.match(matrix, new RegExp(`\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`));
});

test('92. component markers include location, mobile, reduced-motion and status metadata', () => {
  const tags = [...html.matchAll(/<[^>]*data-aegis-component="[^"]+"[^>]*>/g)].map(match => match[0]);
  assert.ok(tags.length >= 32);
  for (const tag of tags) {
    assert.match(tag, /data-component-location="[^"]+"/);
    assert.match(tag, /data-mobile="[^"]+"/);
    assert.match(tag, /data-reduced-motion="[^"]+"/);
    assert.match(tag, /data-component-status="(?:used|adapted)"/);
    assert.doesNotMatch(tag, /(?:^|\s)hidden(?:\s|=)/);
  }
});

test('93. public runtime requests no remote fonts', () => {
  assert.doesNotMatch(`${html}\n${css}\n${blackCss}`, /fonts\.(?:googleapis|gstatic)|@font-face[\s\S]*https?:/i);
});

test('94. public runtime requests no remote images', () => {
  const assets = [...html.matchAll(/<(?:img|source)\b[^>]*(?:src|srcset)="([^"]+)"/g)].map(match => match[1]);
  assert.ok(assets.every(asset => !/^https?:/i.test(asset)));
  assert.doesNotMatch(blackCss, /url\(\s*['"]?https?:/i);
});

test('95. no webcam or media-device access exists', () => {
  assert.doesNotMatch(`${html}\n${app}\n${blackJs}\n${rings}`, /getUserMedia|mediaDevices|webcam/i);
});

test('96. no face-api import or model request exists', () => {
  assert.doesNotMatch(`${html}\n${app}\n${blackJs}\n${rings}\n${packageJson}`, /face-api|tinyFaceDetector|faceLandmark/i);
});

test('97. the rendering-context budget remains one desktop scene and zero mobile scenes', () => {
  assert.equal((html.match(/id="magicRingsMount"/g) || []).length, 1);
  assert.match(rings, /sceneCount: 1/);
  assert.match(rings, /window\.innerWidth < 768/);
});

test('98. animation and WebGL work stop when off-screen or hidden', () => {
  assert.match(blackJs, /IntersectionObserver/);
  assert.match(blackJs, /document\.hidden/);
  assert.match(rings, /else cancelAnimationFrame\(frame\)/);
});

test('99. reduced-motion keeps exact output while removing nonessential motion', () => {
  assert.match(blackCss, /prefers-reduced-motion:reduce/);
  assert.match(blackJs, /reduceMotion\(\)/);
  assert.match(blackCss, /\.rule-velocity div\{transform:none!important\}/);
});

test('100. mobile fallbacks replace heavy or perspective-driven behaviours', () => {
  assert.match(blackCss, /@media \(max-width:760px\)/);
  assert.match(html, /data-mobile="svg-fallback"/);
  assert.match(html, /data-mobile="replaced-by-dock"/);
});

test('101. hero headline stays inside the requested desktop range and below the 54px maximum', () => {
  assert.match(blackCss, /--bl-font-hero:clamp\(40px,3\.8vw,50px\)/);
  assert.match(blackCss, /\.hero h1\{[^}]*font-size:var\(--bl-font-hero\)!important/);
});

test('102. section headings are capped at the requested 40px desktop maximum', () => {
  assert.match(blackCss, /--bl-font-section:clamp\(32px,3\.1vw,40px\)/);
});

test('103. important evidence uses a 14px minimum token', () => {
  assert.match(blackCss, /--bl-font-evidence:14px/);
  assert.match(blackCss, /judge-result span[\s\S]*font-size:var\(--bl-font-evidence\)!important/);
});

test('104. every required mobile composition explicitly contains horizontal overflow', () => {
  assert.match(`${css}\n${blackCss}`, /overflow-x:hidden/);
  assert.match(blackCss, /\.option-wheel\{[^}]*overflow-y:auto/);
});

test('105. Judge primary action remains reachable in a sticky mobile control plane', () => {
  assert.match(html, /id="judgeNext"/);
  assert.match(blackCss, /\.judge-navigation\{position:sticky;bottom:0/);
});

test('106. full Attack Suite stops at pending and never automates owner freeze', () => {
  const suite = blackJs.match(/function runAttackSuite\(\)[\s\S]*?\n\}/)?.[0] ?? '';
  assert.match(suite, /'pending'/);
  assert.doesNotMatch(suite, /storyKillSwitch.*click|activate.*Kill/i);
  assert.match(html, /id="storyKillSwitch" disabled/);
});

test('107. the new wrong-task screen path is evaluated by the canonical engine', () => {
  assert.match(app, /makeIntent\('WRONG-TASK',[\s\S]*taskId: 'UNRELATED-RESEARCH-TASK'/);
  assert.match(app, /state\.engine\.processIntent\(intent\)/);
});

test('108. contract proof remains truthful local-EVM test evidence', () => {
  assert.equal(proof.environment, 'LOCAL_EVM');
  assert.equal(proof.realFundsMoved, false);
  assert.ok(!Object.hasOwn(proof, 'publicContractAddress'));
  assert.equal(proof.deploymentStatus, 'NOT_PUBLICLY_DEPLOYED');
  assert.equal(proof.attackVectors.parity, 'PASS');
});

test('109. locked engines, contracts and pre-Black-Label tests remain byte-identical', async () => {
  const expected = {
    'public/policy-engine.js': '94bc4c66bd696dda7ff7fcffa36507d2d440a82851bb9f49d109a5fccf9f1a6a',
    'public/judge-mode.js': 'c921b0a263788bba368032742865f88142b2fbf2bc4489ca57c83c0b9efe2bc5',
    'public/visual-state.js': '7906c771ea79f7262d604438a0f0ae173763b730808e01043a09ec700f167473',
    'contracts/src/AegisPolicyWallet.sol': '44aaaccf792364d35ee9410e3a394e81f9409affd1b3fb6871f4c5cb55b5918c',
    'contracts/src/MockINRToken.sol': '8be461866a59d389f3a651a7afee5f8e9a7a1c7617091401f79df51e294daa27',
    'tests/policy-engine.test.js': 'fde0231b82d72a15071341843d679cdb939133101ace2e46fb6841c8ed1f2861',
    'tests/judge-mode.test.js': 'c7881852480f7393ef75040d3a2a23ffb0ffd0b5702a6a9ed8b37b029a0c03e2',
    'tests/visual-system.test.js': '62f8f6621535aa37f82580f1af406c0c2c479b6cd8fc352e6167d4b7523ebb3e',
    'tests/signature-visual.test.js': '15b347faa1c11f1ccc3ee7863518d4a742bbc90e6751c22e5505b0051f8d1d6e',
    'tests/contract-proof.test.js': '3774cae5d3f47f622913416f6c683f529a164eb452776f949da52e1040a8fe1c',
    'tests/cinematic-visual.test.js': 'a37a9224e243e82e84ce2c09b0c60b4df5c8465bf48a89af5b70f17b107b00c4',
    'tests/final-art-direction.test.js': 'b6d155b2345f84e53d52abc89c2d143b46ff531923f29594ad76a13b18bfea3e',
    'contracts/test/AegisPolicyWallet.test.js': '479481213b109fbc33614b7cdeacffd16db5eaa602c7357a141c0ee2d4421e23',
    'contracts/test-vectors/aegis-vectors.json': '15644adb8ac263b74f2ed518d056e0fb8c297dc423d138f16ec90f8d799be83c',
  };
  for (const [path, hash] of Object.entries(expected)) assert.equal(digest(await read(path)), hash, path);
});

test('110. Black Label browser audit reports no console or overflow failures when present', async () => {
  const path = new URL('docs/screenshots/black-label/browser-audit.json', root);
  const audit = await readFile(path, 'utf8').then(JSON.parse).catch(() => ({ viewports: [] }));
  for (const viewport of audit.viewports) {
    assert.equal(viewport.horizontalOverflow, 0);
    assert.deepEqual(viewport.consoleErrors, []);
  }
});

test('111. public and dist output are byte-identical after build', async () => {
  const files = await readdir(new URL('public/', root));
  for (const file of files) {
    const publicFile = await readFile(new URL(`public/${file}`, root));
    const distFile = await readFile(new URL(`dist/${file}`, root));
    assert.deepEqual(distFile, publicFile, file);
  }
});

test('112. component audit and static build commands are wired without a blockchain startup', () => {
  const scripts = JSON.parse(packageJson).scripts;
  assert.match(scripts['component:audit'], /audit-components\.mjs/);
  assert.match(scripts.build, /build\.mjs/);
  assert.doesNotMatch(scripts.build, /hardhat|anvil|contract/);
});
