import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';

import handler, { sentinelConfiguration } from '../api/lyzr-sentinel.js';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [packageText, generator, cleanBuild, html, css, boot, sentinel, vercelText, smoke] = await Promise.all([
  read('package.json'), read('scripts/generate-project-proof.mjs'), read('scripts/test-clean-production-build.mjs'),
  read('public/index.html'), read('public/release-candidate.css'), read('public/boot-sequence.js'), read('public/sentinel.js'), read('vercel.json'), read('scripts/test-lyzr-live.mjs'),
]);
const packageJson = JSON.parse(packageText);

const incident = Object.freeze({
  schema_version: 1,
  simulated_funds: true,
  environment: 'TEST_ENVIRONMENT',
  context: 'DEPLOYMENT_RECOVERY_TEST',
  client_id: 'synthetic-test-session',
  incident_hash: 'b'.repeat(64),
  policy: {
    version: 4,
    per_transaction_limit_paise: 250000,
    daily_cumulative_limit_paise: 750000,
    total_budget_paise: 1000000,
    settlement_delay_seconds: 10,
    violation_threshold: 55,
    approved_recipients: ['CloudGrid', 'ComputeHub'],
  },
  evidence: [{
    id: 'RECOVERY-EV-1', event_type: 'AUTHORISATION', decision: 'BLOCK', decisive_rule: 'PER_TRANSACTION_LIMIT',
    risk_state: 'CAUTION', policy_version: 4, final_status: 'BLOCKED', funds_moved_paise: 0,
    intent_amount_paise: 250100, recipient_class: 'APPROVED_RECIPIENT',
  }],
});

function responseMock() {
  return {
    headers: {}, statusCode: 200, body: null,
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function withEnvironment(values, callback) {
  const keys = ['LYZR_ENABLED', 'LYZR_API_KEY', 'LYZR_AGENT_ID', 'LYZR_API_URL'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, values);
  try { return await callback(); }
  finally {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

test('199. production proof check succeeds from tracked evidence without contract runtime results', () => {
  const result = spawnSync(process.execPath, ['scripts/generate-project-proof.mjs', '--check'], { cwd: new URL('../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stderr ?? ''}\n${result.stdout ?? ''}`);
  assert.match(generator, /tracked evidence only/);
  const checkBranch = generator.slice(generator.indexOf('const browser = await countBrowserTests()'));
  assert.ok(checkBranch.indexOf('verifyTrackedEvidence') > checkBranch.indexOf('if (refresh)'));
});

test('200. refresh and production proof paths are explicit and build never starts Hardhat', () => {
  assert.match(packageJson.scripts['proof:refresh'], /contract:test[\s\S]*contract:demo[\s\S]*contract:parity[\s\S]*contract:proof/);
  assert.equal(packageJson.scripts['proof:check'], 'node scripts/generate-project-proof.mjs --check');
  assert.doesNotMatch(packageJson.scripts.build, /hardhat|contract:test|contract:proof/);
});

test('201. clean-build regression excludes ignored results and all contract dependencies', () => {
  for (const file of ['contracts/test-results.json', 'contracts/parity-results.json', 'contracts/attack-report.json', 'contracts/attack-results.json']) assert.match(cleanBuild, new RegExp(file.replaceAll('/', '\\/')));
  assert.match(cleanBuild, /contracts\/node_modules/);
  assert.match(cleanBuild, /assertTreesEqual/);
  assert.equal(packageJson.scripts['test:clean-build'], 'node scripts/test-clean-production-build.mjs');
});

test('202. release assets are linked, initialized, and use the new SVG identity', () => {
  assert.match(html, /href="\.\/release-candidate\.css"/);
  assert.match(html, /src="\.\/boot-sequence\.js"/);
  assert.match(html, /src="\.\/sentinel\.js"/);
  assert.match(html, /href="\.\/favicon\.svg"/);
  assert.match(css, /mask-image:url\('\.\/aegis-logo\.svg'\)/);
  assert.match(css, /mask-image:url\('\.\/aegis-wordmark\.svg'\)/);
  assert.match(boot, /initBootSequence\(\)/);
});

test('203. Research Mode is selected before first paint and persists without a fallback flash', () => {
  assert.ok(html.indexOf("localStorage.getItem('aegis-theme')") < html.indexOf('<link rel="stylesheet"'));
  assert.match(html, /document\.documentElement\.dataset\.theme=theme/);
  assert.match(css, /html\[data-theme="research"\]\{[\s\S]*--aegis-rc-canvas:#eee8dc/);
});

test('204. Vercel clean-URL rewrites cannot swallow the serverless Sentinel route', () => {
  const config = JSON.parse(vercelText);
  assert.deepEqual(config.rewrites, [{ source: '/control-centre', destination: '/' }, { source: '/judge-mode', destination: '/' }]);
  assert.ok(config.rewrites.every(rule => !rule.source.startsWith('/api') && !rule.source.includes('(.*)')));
});

test('205. Sentinel diagnostics distinguish disabled, incomplete, and ready without secret material', () => {
  assert.deepEqual(sentinelConfiguration({}), { enabled: false, configured: false, status: 'DISABLED' });
  assert.deepEqual(sentinelConfiguration({ LYZR_ENABLED: '1' }), { enabled: true, configured: false, status: 'INCOMPLETE_CONFIGURATION' });
  assert.deepEqual(sentinelConfiguration({ LYZR_ENABLED: '1', LYZR_API_KEY: 'secret', LYZR_AGENT_ID: 'agent', LYZR_API_URL: 'https://example.test/agent' }), { enabled: true, configured: true, status: 'READY' });
  assert.doesNotMatch(JSON.stringify(sentinelConfiguration({ LYZR_ENABLED: '1', LYZR_API_KEY: 'secret', LYZR_AGENT_ID: 'agent', LYZR_API_URL: 'https://example.test/agent' })), /secret|agent|example/);
});

test('206. GET returns only a safe configuration diagnostic', async () => withEnvironment({ LYZR_ENABLED: '1' }, async () => {
  const res = responseMock();
  await handler({ method: 'GET', headers: {} }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, enabled: true, configured: false, status: 'INCOMPLETE_CONFIGURATION', advisory_only: true });
}));

test('207. POST fails closed with distinct disabled and incomplete configuration states', async () => {
  await withEnvironment({}, async () => {
    const res = responseMock();
    await handler({ method: 'POST', headers: { origin: 'https://aegis.test', host: 'aegis.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: incident }, res);
    assert.equal(res.body.error, 'SENTINEL_DISABLED');
  });
  await withEnvironment({ LYZR_ENABLED: '1' }, async () => {
    const res = responseMock();
    await handler({ method: 'POST', headers: { origin: 'https://aegis.test', host: 'aegis.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: incident }, res);
    assert.equal(res.body.error, 'SENTINEL_INCOMPLETE_CONFIGURATION');
  });
});

test('208. configured upstream failure is normalized without leaking headers or credentials', async () => withEnvironment({ LYZR_ENABLED: '1', LYZR_API_KEY: 'mock-secret', LYZR_AGENT_ID: 'mock-agent', LYZR_API_URL: 'https://example.test/sentinel' }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 503 });
  const res = responseMock();
  try { await handler({ method: 'POST', headers: { origin: 'https://aegis.test', host: 'aegis.test', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: incident }, res); }
  finally { globalThis.fetch = originalFetch; }
  assert.equal(res.statusCode, 502);
  assert.equal(res.body.error, 'SENTINEL_UPSTREAM_UNAVAILABLE');
  assert.doesNotMatch(JSON.stringify(res.body), /mock-secret|mock-agent|example\.test|x-api-key/);
}));

test('209. all four Sentinel entry points are explicit-click advisory surfaces', () => {
  assert.equal((html.match(/data-sentinel-open/g) || []).length, 4);
  for (const context of ['FORENSIC_PROOF_LEDGER', 'RED_TEAM_RESULT', 'POLICY_DIGITAL_TWIN', 'JUDGE_MODE_EVIDENCE']) assert.match(html, new RegExp(`data-sentinel-context="${context}"`));
  assert.match(html, /Sentinel advises\. The deterministic Aegis engine and Policy Wallet remain the enforcement authority\./);
  assert.match(sentinel, /addEventListener\('click', ask\)/);
  assert.doesNotMatch(sentinel, /DOMContentLoaded[^\n]+ask\(\)/);
});

test('210. automated tests cannot spend Lyzr credits and the smoke script permits one request only', () => {
  assert.match(smoke, /ALLOW_LYZR_LIVE !== '1'/);
  assert.equal((smoke.match(/await fetch\(/g) || []).length, 1);
  assert.doesNotMatch(packageJson.scripts.test, /lyzr:smoke/);
  assert.doesNotMatch(packageJson.scripts['test:all'], /lyzr:smoke/);
});

test('211. no public release asset contains a Sentinel server credential name', async () => {
  const files = await readdir(new URL('../public/', import.meta.url));
  const source = (await Promise.all(files.map(file => read(`public/${file}`).catch(() => '')))).join('\n');
  assert.doesNotMatch(source, /LYZR_API_KEY|x-api-key/);
});
