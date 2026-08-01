import { writeFile } from 'node:fs/promises';

const [baseUrl = 'http://localhost:4174/', outputPath] = process.argv.slice(2);
if (!outputPath) throw new Error('Usage: final-viewport-audit.mjs <baseUrl> <output.json>');

const viewports = [[1440, 900], [1280, 720], [1024, 768], [768, 1024], [430, 932], [390, 844], [360, 800]];
const pages = await fetch('http://127.0.0.1:9223/json').then(response => response.json());
const page = pages.find(candidate => candidate.type === 'page');
if (!page) throw new Error('No Chrome page target is available on port 9223.');
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
const pending = new Map();
let errors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails?.exception?.description || 'Runtime exception');
  if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') errors.push(message.params.entry.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
const results = [];

for (const [width, height] of viewports) {
  const mobile = width < 768;
  await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  const url = new URL(baseUrl);
  url.searchParams.set('capture', 'audit-projector');
  errors = [];
  await send('Page.navigate', { url: url.toString() });
  errors = [];
  await wait(1500);
  const evaluated = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const px = selector => Number.parseFloat(getComputedStyle(document.querySelector(selector)).fontSize);
      const action = document.querySelector('#judgeNext').getBoundingClientRect();
      const critical = {
        heroHeadline: px('.hero h1'),
        judgeAmount: px('#judgeAmount'),
        decisiveRule: px('#judgeCurrentRule'),
        riskState: px('#judgeRiskState'),
        policyVersion: px('#judgePolicyVersion'),
        fundsMoved: px('#judgeFacts b'),
        judgeAction: px('#judgeNext'),
        legal: px('footer .legal')
      };
      return {
        width: innerWidth,
        height: innerHeight,
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        modalHorizontalOverflow: document.querySelector('#judgeCard').scrollWidth - document.querySelector('#judgeCard').clientWidth,
        actionReachable: action.width > 0 && action.left >= 0 && action.right <= innerWidth && action.bottom <= innerHeight,
        focusInsideModal: document.querySelector('#judgeModal').contains(document.activeElement),
        judgeState: window.__AEGIS_DIAGNOSTICS__?.judge().status,
        proofState: document.documentElement.dataset.contractProof,
        regulatoryPresent: document.querySelector('footer .legal').textContent.includes('simulated/test funds'),
        critical
      };
    })())`,
    returnByValue: true,
  });
  results.push({ ...JSON.parse(evaluated.result.value), consoleErrors: [...errors] });
}

await send('Emulation.setEmulatedMedia', { media: '', features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
errors = [];
const reducedUrl = new URL(baseUrl);
reducedUrl.searchParams.set('capture', 'judge-approved');
await send('Page.navigate', { url: reducedUrl.toString() });
errors = [];
await wait(1500);
const reducedResult = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    renderer: document.querySelector('#magicRingsMount').dataset.rendererState,
    judgeState: window.__AEGIS_DIAGNOSTICS__?.judge().status,
    engineDecision: document.querySelector('#judgeResult').textContent.trim(),
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  })`,
  returnByValue: true,
});
const report = { viewports: results, reducedMotion: { ...JSON.parse(reducedResult.result.value), consoleErrors: [...errors] } };
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
socket.close();

const failures = results.filter(result => result.horizontalOverflow || result.modalHorizontalOverflow || !result.actionReachable || !result.focusInsideModal || result.proofState !== 'verified' || !result.regulatoryPresent || result.consoleErrors.length || result.critical.decisiveRule < 14 || result.critical.riskState < 14 || result.critical.policyVersion < 14 || result.critical.judgeAmount < 14 || result.critical.fundsMoved < 14 || result.critical.judgeAction < 14 || result.critical.legal < 12.5);
if (failures.length || report.reducedMotion.renderer !== 'fallback' || report.reducedMotion.judgeState !== 'COMPLETE' || report.reducedMotion.horizontalOverflow || report.reducedMotion.consoleErrors.length) {
  throw new Error(`Viewport audit failed at: ${failures.map(result => `${result.width}x${result.height}`).join(', ') || 'reduced-motion'}`);
}
process.stdout.write(`Verified ${results.length} required viewports plus reduced-motion execution.\n`);
