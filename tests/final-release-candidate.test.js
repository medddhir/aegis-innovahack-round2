import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

import handler from '../api/lyzr-sentinel.js';
import { parseLyzrResponse, validateIncident, validateRecommendation } from '../lib/sentinel-validation.js';
import { AegisPolicyEngine, DEFAULT_POLICY } from '../public/policy-engine.js';
import { applySentinelPatch, normalizeSentinelEvidence, simulateSentinelRecommendation, validateSentinelRecommendationClient } from '../public/sentinel.js';
import { MAX_DURATION_MS, shouldShowBoot } from '../public/boot-sequence.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const digest = value => createHash('sha256').update(value).digest('hex');
const [html, css, app, blackJs, sentinelJs, bootJs, readme, packageText, vercelText, projectProof, contractProof, auditMatrix] = await Promise.all([
  read('public/index.html'), read('public/release-candidate.css'), read('public/app.js'), read('public/black-label.js'), read('public/sentinel.js'), read('public/boot-sequence.js'),
  read('README.md'), read('package.json'), read('vercel.json'), read('public/project-proof.json').then(JSON.parse), read('public/contract-proof.json').then(JSON.parse), read('docs/FINAL_AUDIT_REPAIR_MATRIX.md'),
]);

const incidentInput = Object.freeze({
  schema_version: 1, simulated_funds: true, environment: 'TEST_ENVIRONMENT', context: 'TEST_INCIDENT', client_id: 'test-session', incident_hash: 'a'.repeat(64),
  policy: { version: 4, per_transaction_limit_paise: 250000, daily_cumulative_limit_paise: 750000, total_budget_paise: 1000000, settlement_delay_seconds: 10, violation_threshold: 55, approved_recipients: ['CloudGrid', 'ComputeHub'] },
  evidence: [{ id: 'EV-1', event_type: 'AUTHORISATION', decision: 'BLOCK', decisive_rule: 'PER_TRANSACTION_LIMIT', risk_state: 'CAUTION', policy_version: 4, final_status: 'BLOCKED', funds_moved_paise: 0, intent_amount_paise: 250100, recipient_class: 'APPROVED_RECIPIENT' }],
});
const recommendationInput = Object.freeze({
  incident_summary: 'A simulated request exceeded the current transaction boundary.', attack_classification: 'LIMIT_PROBING', severity: 'MEDIUM', evidence_sufficient: true,
  evidence_ids: ['EV-1'], decisive_rules: ['PER_TRANSACTION_LIMIT'], recommended_patch: { per_transaction_limit_paise: 240000, settlement_delay_seconds: 12 },
  change_required: true, rationale: 'A smaller transaction boundary and longer review window reduce authority.', human_approval_required: true, confidence: 0.88, limitations: ['Simulation evidence only.'],
});

function responseMock() {
  return { headers: {}, statusCode: 200, body: null, setHeader(key, value) { this.headers[key] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
}

function withLyzrEnvironment(callback) {
  const previous = { ...process.env };
  Object.assign(process.env, { LYZR_ENABLED: '1', LYZR_API_KEY: 'mock-key-not-real', LYZR_AGENT_ID: 'mock-agent', LYZR_API_URL: 'https://agent-prod.studio.lyzr.ai/v3/inference/chat/' });
  return Promise.resolve(callback()).finally(() => {
    for (const key of ['LYZR_ENABLED', 'LYZR_API_KEY', 'LYZR_AGENT_ID', 'LYZR_API_URL']) {
      if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
    }
  });
}

test('165. every independent-audit P2 is closed in the repair matrix', () => {
  for (const id of ['AEGIS-001', 'AEGIS-002', 'AEGIS-003', 'AEGIS-004', 'AEGIS-005']) assert.match(auditMatrix, new RegExp(`\\| ${id} \\| P2 \\|[^\n]+\\| CLOSED \\|`));
});

test('166. generated browser proof equals current test declarations', async () => {
  const files = (await readdir(new URL('tests/', root))).filter(file => file.endsWith('.test.js'));
  let declared = 0;
  for (const file of files) declared += ((await read(`tests/${file}`)).match(/^\s*test\s*\(/gm) || []).length;
  assert.equal(projectProof.browserPresentation.total, declared);
  assert.equal(projectProof.browserPresentation.passed, declared);
});

test('167. README proof is generated from one bounded marker block', () => {
  assert.match(readme, /AEGIS_PROJECT_PROOF_START[\s\S]*passing browser\/presentation tests[\s\S]*AEGIS_PROJECT_PROOF_END/);
  assert.match(JSON.parse(packageText).scripts['proof:check'], /generate-project-proof\.mjs --check/);
});

test('168. website proof reads and validates the generated project source', () => {
  assert.match(app, /fetch\('\.\/project-proof\.json'/);
  assert.match(app, /proof\.projectProofSource !== 'public\/project-proof\.json'/);
  assert.equal(contractProof.browserTests.total, projectProof.browserPresentation.total);
});

test('169. no stale 136 value represents current proof evidence', () => {
  assert.doesNotMatch(`${readme}\n${JSON.stringify(projectProof)}\n${JSON.stringify(contractProof)}`, /136 passing|"total"\s*:\s*136/);
});

test('170. Lyzr credentials are absent from every public asset', async () => {
  const files = await readdir(new URL('public/', root));
  const publicSource = (await Promise.all(files.filter(file => !file.endsWith('.png')).map(file => read(`public/${file}`).catch(() => '')))).join('\n');
  assert.doesNotMatch(publicSource, /LYZR_API_KEY|x-api-key|sk-(?:default|live|test)-[A-Za-z0-9]/i);
});

test('171. the browser calls Sentinel through the same-origin proxy only', () => {
  assert.match(sentinelJs, /fetch\('\/api\/lyzr-sentinel'/);
  assert.doesNotMatch(sentinelJs, /agent-prod\.studio\.lyzr|agent\.api\.lyzr|x-api-key/);
});

test('172. Sentinel never calls Lyzr automatically on page load', () => {
  assert.match(sentinelJs, /#sentinelAsk'\)\.addEventListener\('click', ask\)/);
  assert.doesNotMatch(sentinelJs, /DOMContentLoaded[^\n]+ask\(\)/);
});

test('173. duplicate clicks are gated before the upstream fetch', () => {
  const ask = sentinelJs.match(/async function ask\(\)[\s\S]*?\n  }\n\n  function simulate/)?.[0] ?? '';
  assert.ok(ask.indexOf('if (running) return') < ask.indexOf("fetch('/api/lyzr-sentinel'"));
  assert.ok(ask.indexOf('running = true') < ask.indexOf("fetch('/api/lyzr-sentinel'"));
});

test('174. deterministic incident cache returns before a second request', () => {
  const ask = sentinelJs.match(/async function ask\(\)[\s\S]*?\n  }\n\n  function simulate/)?.[0] ?? '';
  assert.ok(ask.indexOf('const cached = sessionGet') < ask.indexOf('requestCount += 1'));
  assert.match(ask, /cacheHitCount \+= 1;[\s\S]*return;/);
});

test('175. proxy timeout returns a safe advisory error and no financial result', async () => withLyzrEnvironment(async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { const error = new Error('aborted'); error.name = 'AbortError'; throw error; };
  const res = responseMock();
  try { await handler({ method: 'POST', headers: { origin: 'https://aegis.test', host: 'aegis.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: incidentInput }, res); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(res.statusCode, 504);
  assert.equal(res.body.error, 'SENTINEL_TIMEOUT');
  assert.match(res.body.message, /Aegis enforcement remains operational/);
}));

test('176. invalid structured Lyzr output is rejected', () => {
  assert.throws(() => parseLyzrResponse({ response: 'not-json' }), /invalid structured JSON/i);
  assert.throws(() => validateRecommendation({ ...recommendationInput, unexpected: true }, validateIncident(incidentInput)), /unsupported fields/i);
});

test('177. unsafe policy increases are rejected server-side and client-side', () => {
  const unsafe = { ...recommendationInput, recommended_patch: { per_transaction_limit_paise: 250001 } };
  assert.throws(() => validateRecommendation(unsafe, validateIncident(incidentInput)), /cannot increase/i);
  assert.throws(() => validateSentinelRecommendationClient(unsafe, DEFAULT_POLICY, incidentInput.evidence), /exceeds the current authority/i);
});

test('178. a new-recipient recommendation is rejected', () => {
  const unsafe = { ...recommendationInput, recommended_patch: { remove_recipients: ['NewVendor'] } };
  assert.throws(() => validateRecommendation(unsafe, validateIncident(incidentInput)), /current allowlist/i);
  assert.throws(() => validateSentinelRecommendationClient(unsafe, DEFAULT_POLICY), /allowlist boundary/i);
});

test('179. Sentinel simulation cannot mutate canonical engine state', () => {
  const engine = new AegisPolicyEngine({ clock: () => '2026-08-01T10:00:00.000Z' });
  const before = engine.getSnapshot();
  simulateSentinelRecommendation(before.policy, recommendationInput);
  assert.deepEqual(engine.getSnapshot(), before);
});

test('180. Sentinel evidence normalization cannot alter ledger evidence', () => {
  const ledger = [{ eventId: 'EV-1', eventType: 'AUTHORISATION', decision: 'BLOCK', ruleChecked: 'PER_TRANSACTION_LIMIT', policyVersion: 4, finalSettlementStatus: 'BLOCKED', fundsMoved: 0, intent: { id: 'I-1', amount: 2501, recipient: 'CloudGrid' } }];
  const before = structuredClone(ledger);
  normalizeSentinelEvidence(ledger, DEFAULT_POLICY);
  assert.deepEqual(ledger, before);
});

test('181. Digital Twin refuses a recommendation outside client safety validation', () => {
  assert.throws(() => simulateSentinelRecommendation(DEFAULT_POLICY, { ...recommendationInput, human_approval_required: false }), /Human approval/);
  assert.deepEqual(applySentinelPatch(DEFAULT_POLICY, recommendationInput).approvedRecipients, DEFAULT_POLICY.approvedRecipients);
});

test('182. automated tests cannot activate the opt-in live smoke request', async () => {
  const smoke = await read('scripts/test-lyzr-live.mjs');
  assert.match(smoke, /ALLOW_LYZR_LIVE !== '1'/);
  assert.equal((smoke.match(/await fetch\(/g) || []).length, 1);
  assert.doesNotMatch(JSON.parse(packageText).scripts.test, /lyzr:smoke/);
});

test('183. original Aegis SVG identity is scalable and structurally bounded', async () => {
  const [logo, wordmark, favicon] = await Promise.all([read('public/aegis-logo.svg'), read('public/aegis-wordmark.svg'), read('public/favicon.svg')]);
  assert.match(logo, /viewBox="0 0 64 64"/);
  assert.match(logo, /Four enforcement layers/);
  assert.match(wordmark, /viewBox="0 0 184 48"/);
  assert.match(favicon, /viewBox="0 0 64 64"/);
  assert.ok((logo.match(/<path/g) || []).length <= 8);
});

test('184. logo and wordmark have explicit Command and Research treatments', () => {
  assert.match(css, /\.aegis-brand-symbol[^}]*mask-image:url\('\.\/aegis-logo\.svg'\)/);
  assert.match(css, /html\[data-theme="research"\] \.aegis-brand-symbol/);
  assert.match(html, /class="aegis-brand-symbol"/);
});

test('185. startup sequence is once-per-session with explicit replay support', () => {
  assert.equal(shouldShowBoot({ seen: false }), true);
  assert.equal(shouldShowBoot({ seen: true }), false);
  assert.equal(shouldShowBoot({ search: '?intro=1', seen: true }), true);
  assert.match(bootJs, /sessionStorage\.setItem\(SESSION_KEY, '1'\)/);
});

test('186. startup is skippable by click, Enter, Space, or Escape', () => {
  assert.match(html, /id="bootSkip"/);
  assert.match(bootJs, /\['Enter', ' ', 'Escape'\]/);
  assert.match(bootJs, /restoreFocus: true/);
  assert.ok(MAX_DURATION_MS <= 1_500);
});

test('187. reduced-motion startup resolves almost immediately', () => {
  assert.match(bootJs, /reduced \? 20 : MAX_DURATION_MS/);
  assert.match(css, /prefers-reduced-motion:reduce[\s\S]*\.boot-layer/);
});

test('188. startup is presentation-only and cannot mutate engine state', () => {
  assert.doesNotMatch(bootJs, /policy-engine|AegisPolicyEngine|processIntent|freezeAgent|settleIntent/);
  assert.doesNotMatch(bootJs, /fetch\(/);
});

test('189. Research Mode is applied synchronously before stylesheet rendering', () => {
  const prepaint = html.indexOf("localStorage.getItem('aegis-theme')");
  const stylesheet = html.indexOf('<link rel="stylesheet"');
  assert.ok(prepaint > 0 && prepaint < stylesheet);
  assert.match(blackJs, /prepainted = document\.documentElement\.dataset\.theme/);
});

test('190. Research Mode primary and secondary contrast tokens exceed WCAG AA', () => {
  const luminance = hex => {
    const channels = hex.match(/../g).map(value => Number.parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);
  assert.ok(contrast('14242d', 'eee8dc') >= 4.5);
  assert.ok(contrast('3c5360', 'eee8dc') >= 4.5);
  assert.ok(contrast('536a76', 'eee8dc') >= 4.5);
});

test('191. Research Mode and rapid resize have a defensive overflow boundary', () => {
  assert.match(css, /html,body\{max-width:100%;overflow-x:clip\}/);
  assert.match(css, /html\[data-theme="research"\][\s\S]*--aegis-rc-canvas:#eee8dc/);
});

test('192. Command Mode remains the unscoped default and Research overrides stay scoped', () => {
  assert.match(css, /^:root\{[\s\S]*--aegis-rc-canvas:#050a0f/m);
  assert.doesNotMatch(css, /html\[data-theme="command"\][\s\S]*background:/);
});

test('193. all locked release source hashes remain unchanged', async () => {
  const expected = {
    'public/policy-engine.js': '94bc4c66bd696dda7ff7fcffa36507d2d440a82851bb9f49d109a5fccf9f1a6a',
    'public/judge-mode.js': 'c921b0a263788bba368032742865f88142b2fbf2bc4489ca57c83c0b9efe2bc5',
    'public/visual-state.js': '7906c771ea79f7262d604438a0f0ae173763b730808e01043a09ec700f167473',
    'public/red-team-lab.js': '24b4bd4f34682a857cc3d5ee17d6913b642c5a93def199460d31c0243294c6d4',
    'public/red-team-session.js': '191687c904e657f34178485cf517a535593416f95a2d9a8f88e3cf13c08ce0b0',
    'contracts/src/AegisPolicyWallet.sol': '44aaaccf792364d35ee9410e3a394e81f9409affd1b3fb6871f4c5cb55b5918c',
    'contracts/src/MockINRToken.sol': '8be461866a59d389f3a651a7afee5f8e9a7a1c7617091401f79df51e294daa27',
    'contracts/test/AegisPolicyWallet.test.js': '479481213b109fbc33614b7cdeacffd16db5eaa602c7357a141c0ee2d4421e23',
    'contracts/test-vectors/aegis-vectors.json': '15644adb8ac263b74f2ed518d056e0fb8c297dc423d138f16ec90f8d799be83c',
  };
  for (const [path, hash] of Object.entries(expected)) assert.equal(digest(await read(path)), hash, path);
});

test('194. contract proof remains truthful and synchronized', () => {
  assert.equal(contractProof.environment, 'LOCAL_EVM');
  assert.equal(contractProof.realFundsMoved, false);
  assert.equal(contractProof.deploymentStatus, 'NOT_PUBLICLY_DEPLOYED');
  assert.equal(projectProof.attackDemo.total, 12);
  assert.equal(projectProof.vectorParity.result, 'PASS');
});

test('195. audit evidence files are non-vacuous before viewport assertions run', async () => {
  const [black, red] = await Promise.all([read('docs/screenshots/black-label/browser-audit.json').then(JSON.parse), read('docs/screenshots/red-team-lab/browser-audit.json').then(JSON.parse)]);
  assert.ok(black.viewports.length > 0);
  assert.ok((red.captures?.length ?? 0) + (red.viewports?.length ?? 0) > 0);
});

test('196. public deployment rewrites preserve both declared clean URLs', () => {
  const config = JSON.parse(vercelText);
  assert.deepEqual(config.rewrites, [{ source: '/control-centre', destination: '/' }, { source: '/judge-mode', destination: '/' }]);
});

test('197. global Reset invokes all three existing deterministic reset surfaces', () => {
  assert.match(blackJs, /action === 'reset'[^\n]*aegis:reset-all/);
  assert.match(app, /aegis:reset-all[\s\S]*resetEnvironment\(\{ notify: false \}\)[\s\S]*state\.redTeam\?\.reset/);
});

test('198. API accepts one valid mocked Lyzr envelope and returns validated advisory data', async () => withLyzrEnvironment(async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls += 1;
    const upstream = JSON.parse(options.body);
    assert.deepEqual(Object.keys(upstream), ['user_id', 'agent_id', 'session_id', 'message', 'system_prompt_variables', 'filter_variables', 'features']);
    assert.equal(options.headers['x-api-key'], 'mock-key-not-real');
    return { ok: true, json: async () => ({ response: JSON.stringify(recommendationInput) }) };
  };
  const res = responseMock();
  try { await handler({ method: 'POST', headers: { origin: 'https://aegis.test', host: 'aegis.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: incidentInput }, res); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(calls, 1);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.advisory_only, true);
  assert.equal(res.body.recommendation.human_approval_required, true);
}));
