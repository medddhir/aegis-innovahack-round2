import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [baseUrl = 'http://localhost:4173/', outputRoot] = process.argv.slice(2);
if (!outputRoot) throw new Error('Usage: black-label-capture.mjs <baseUrl> <outputDirectory>');

const captures = [
  ['01-hero-1440x900.png', '', 1440, 900, 1200],
  ['02-hero-1280x720.png', '', 1280, 720, 1200],
  ['03-command-mode.png', 'control', 1440, 900, 1400],
  ['04-research-mode.png', 'research', 1440, 900, 1300],
  ['05-threat-scan.png', 'threat', 1440, 900, 1500],
  ['06-budget-capsule-builder.png', 'authority', 1440, 900, 1300],
  ['07-risk-governor.png', 'risk', 1440, 900, 1500],
  ['08-control-centre.png', 'control', 1440, 900, 1300],
  ['09-live-intent-stream.png', 'stream', 1440, 900, 1500],
  ['10-attack-theatre.png', 'attack-theatre', 1440, 900, 1500],
  ['11-evasion-shield.png', 'evasion', 1440, 900, 1600],
  ['12-pending-settlement.png', 'pending', 1440, 900, 1600],
  ['13-owner-kill-switch.png', 'kill', 1440, 900, 1900],
  ['14-policy-digital-twin.png', 'twin', 1440, 900, 1900],
  ['15-forensic-terminal.png', 'forensics', 1440, 900, 1900],
  ['16-contract-proof.png', 'contract', 1440, 900, 1400],
  ['17-illustrative-test-network.png', 'network', 1440, 900, 1400],
  ['18-judge-mode.png', 'judge-approved', 1440, 900, 1600],
  ['19-mobile-hero.png', '', 390, 844, 1300],
  ['20-mobile-control-centre.png', 'mobile-control', 390, 844, 1400],
  ['21-mobile-judge-mode.png', 'mobile-judge', 390, 844, 1800],
];

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
let runtimeErrors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    const callbacks = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception');
  if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') runtimeErrors.push(message.params.entry.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const waitForReady = async () => {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const probe = await send('Runtime.evaluate', {
      expression: "document.documentElement.dataset.contractProof === 'verified' && new Set(window.__AEGIS_BLACK_LABEL__?.components?.() || []).size === 32",
      returnByValue: true,
    });
    if (probe.result.value === true) return;
    await wait(100);
  }
  throw new Error('Black Label runtime did not reach its verified ready state.');
};

await mkdir(outputRoot, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const audits = [];
for (const [filename, mode, width, height, waitMs] of captures) {
  const mobile = width < 768;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await send('Runtime.evaluate', { expression: `localStorage.setItem('aegis-theme', '${mode === 'research' ? 'research' : 'command'}')` });
  const url = new URL(baseUrl);
  if (mode) url.searchParams.set('capture', mode);
  else url.searchParams.set('captureSet', filename);
  runtimeErrors = [];
  await send('Page.navigate', { url: url.toString() });
  await waitForReady();
  await wait(waitMs);
  if (!mode) { await send('Runtime.evaluate', { expression: 'scrollTo(0, 0)' }); await wait(60); }
  const result = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const action = document.querySelector('#judgeNext')?.getBoundingClientRect();
      const heroAction = document.querySelector('#launchJudgeMode')?.getBoundingClientRect();
      const judgeOpen = !document.querySelector('#judgeModal')?.classList.contains('hidden');
      return {
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        modalOverflow: (document.querySelector('#judgeCard')?.scrollWidth || 0) - (document.querySelector('#judgeCard')?.clientWidth || 0),
        proof: document.documentElement.dataset.contractProof || null,
        theme: document.documentElement.dataset.theme || null,
        componentCount: new Set(window.__AEGIS_BLACK_LABEL__?.components() || []).size,
        renderingContexts: window.__AEGIS_BLACK_LABEL__?.renderingContexts() ?? -1,
        judgeOpen,
        judgeActionReachable: !judgeOpen || !!action && action.width > 0 && action.left >= 0 && action.right <= innerWidth && action.bottom <= innerHeight,
        heroActionUsable: !!heroAction && heroAction.width >= 44 && heroAction.height >= 44,
        headlineSize: parseFloat(getComputedStyle(document.querySelector('.hero h1')).fontSize),
        regulatoryPresent: document.querySelector('footer .legal')?.textContent.includes('simulated/test funds') || false
      };
    })())`, returnByValue: true,
  });
  await send('Runtime.evaluate', { expression: "document.querySelector('#toast')?.classList.remove('show')" });
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(outputRoot, filename), Buffer.from(screenshot.data, 'base64'));
  audits.push({ filename, width, height, mode: mode || 'hero', ...JSON.parse(result.result.value), consoleErrors: [...runtimeErrors] });
}

await writeFile(path.join(outputRoot, 'browser-audit.json'), `${JSON.stringify({ viewports: audits }, null, 2)}\n`);
socket.close();
const failures = audits.filter(audit => audit.horizontalOverflow !== 0 || audit.modalOverflow !== 0 || audit.consoleErrors.length || !audit.judgeActionReachable || audit.proof !== 'verified' || audit.componentCount !== 32 || !audit.regulatoryPresent || audit.headlineSize > 54);
if (failures.length) throw new Error(`Black Label browser audit failed: ${failures.map(audit => audit.filename).join(', ')}`);
process.stdout.write(`Captured ${audits.length} Black Label views; 32 components present, zero overflow, zero console errors.\n`);
