import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [html, css, app] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
]);

test('premium shell has local brand metadata and no blocking font request', () => {
  assert.match(html, /rel="icon" href="\.\/favicon\.svg"/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /name="theme-color" content="#071019"/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
});

test('hero preserves competition CTAs and explicit trust boundaries', () => {
  assert.match(html, /Launch Live Attack Simulation/);
  assert.match(html, /Open Control Centre/);
  for (const label of ['Simulated INR', 'No real funds', 'Deterministic enforcement', 'Owner-controlled freeze']) {
    assert.ok(html.includes(label), `missing hero trust label: ${label}`);
  }
  assert.match(html, /data-flow="idle"/);
});

test('visual feedback is bound to canonical result and ledger evidence', () => {
  assert.match(app, /setHeroFlow\(result\)/);
  assert.match(app, /event\.intent\.amount/);
  assert.match(app, /event\.intent\.recipient/);
  assert.match(app, /event\.ruleChecked/);
  assert.match(app, /animateMetric\(\$\('#pendingOverview'\), snapshot\.pendingCount\)/);
});

test('responsive and reduced-motion boundaries are present', () => {
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /@media \(max-width:430px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(css, /\.hero-system\[data-flow="blocked"\]/);
  assert.match(css, /\.judge-visual\[data-flow="invalidated"\]/);
});

test('required regulatory statement remains verbatim', () => {
  assert.ok(html.includes('This prototype uses simulated/test funds. Any production deployment involving real-money movement, custody or operation of a payment system would require applicable regulatory approvals and integration with licensed financial or payment partners.'));
});
