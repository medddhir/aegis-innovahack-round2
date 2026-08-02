import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [baseUrl = 'http://localhost:4183/', outputRoot] = process.argv.slice(2);
if (!outputRoot) throw new Error('Usage: red-team-capture.mjs <baseUrl> <outputDirectory>');

const captures = [
  ['01-empty-custom-challenge.png', 'red-empty', 1440, 900, 700],
  ['02-custom-compliant-payment.png', 'red-compliant', 1440, 900, 900],
  ['03-custom-oversized-payment.png', 'red-oversized', 1440, 900, 900],
  ['04-unknown-recipient.png', 'red-unknown', 1440, 900, 900],
  ['05-custom-split-attack.png', 'red-split', 1440, 900, 900],
  ['06-duplicate-nonce.png', 'red-duplicate', 1440, 900, 900],
  ['07-pending-settlement.png', 'red-pending', 1440, 900, 900],
  ['08-manual-kill-switch.png', 'red-kill', 1440, 900, 1200],
  ['09-session-summary.png', 'red-summary', 1440, 900, 1100],
  ['10-mobile-red-team-lab.png', 'red-empty', 390, 844, 800],
];

const viewports = [
  [1440, 900], [1280, 720], [1024, 768], [768, 1024], [430, 932], [390, 844], [360, 800],
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
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception');
  }
  if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') runtimeErrors.push(message.params.entry.text);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function setViewport(width, height) {
  const mobile = width < 768;
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height,
    screenOrientation: { type: mobile ? 'portraitPrimary' : 'landscapePrimary', angle: 0 },
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
}

async function waitForLab() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const probe = await send('Runtime.evaluate', {
      expression: "window.__AEGIS_DIAGNOSTICS__?.redTeam?.()?.open === true && document.documentElement.dataset.contractProof === 'verified'",
      returnByValue: true,
    });
    if (probe.result.value === true) return;
    await wait(100);
  }
  throw new Error('Red Team Lab did not reach its verified open state.');
}

async function audit(label, width, height, mode) {
  const result = await send('Runtime.evaluate', {
    expression: `JSON.stringify((() => {
      const action = document.querySelector('#redTeamSubmit')?.getBoundingClientRect();
      const shell = document.querySelector('#redTeamShell');
      const diagnostic = window.__AEGIS_DIAGNOSTICS__?.redTeam?.();
      return {
        label: ${JSON.stringify(label)},
        width: ${width},
        height: ${height},
        mode: ${JSON.stringify(mode)},
        horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        modalOverflow: (shell?.scrollWidth || 0) - (shell?.clientWidth || 0),
        actionReachable: !!action && action.width >= 44 && action.height >= 44 && action.left >= 0 && action.right <= innerWidth && action.bottom <= innerHeight,
        modalOpen: diagnostic?.open === true,
        lastDecision: diagnostic?.lastOutcome?.decision || null,
        decisiveRule: diagnostic?.lastOutcome?.ruleChecked || null,
        fundsMoved: diagnostic?.lastOutcome?.fundsMoved ?? null,
        proof: document.documentElement.dataset.contractProof || null,
        focusContained: shell?.contains(document.activeElement) || false,
        contractBoundaryTruthful: document.querySelector('#redTeamBoundary')?.textContent.includes('deterministic Aegis browser engine') && document.querySelector('#redTeamBoundary')?.textContent.includes('local-EVM contract suite'),
        presetCount: document.querySelectorAll('[data-red-preset]').length,
        evidenceVisible: !!document.querySelector('#redTeamResult')?.getClientRects().length
      };
    })())`,
    returnByValue: true,
  });
  return { ...JSON.parse(result.result.value), consoleErrors: [...runtimeErrors] };
}

await mkdir(outputRoot, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const captureAudits = [];
for (const [filename, mode, width, height, waitMs] of captures) {
  await setViewport(width, height);
  runtimeErrors = [];
  const url = new URL(baseUrl);
  url.searchParams.set('capture', mode);
  await send('Page.navigate', { url: url.toString() });
  await waitForLab();
  await wait(waitMs);
  const record = await audit(filename, width, height, mode);
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(outputRoot, filename), Buffer.from(screenshot.data, 'base64'));
  captureAudits.push(record);
}

const viewportAudits = [];
for (const [width, height] of viewports) {
  await setViewport(width, height);
  runtimeErrors = [];
  const url = new URL(baseUrl);
  url.searchParams.set('capture', 'red-empty');
  await send('Page.navigate', { url: url.toString() });
  await waitForLab();
  await wait(500);
  viewportAudits.push(await audit(`${width}x${height}`, width, height, 'red-empty'));
}

await setViewport(390, 844);
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
runtimeErrors = [];
{
  const url = new URL(baseUrl);
  url.searchParams.set('capture', 'red-compliant');
  await send('Page.navigate', { url: url.toString() });
  await waitForLab();
  await wait(700);
  const reduced = await audit('390x844-reduced-motion', 390, 844, 'red-compliant');
  const motion = await send('Runtime.evaluate', {
    expression: "getComputedStyle(document.querySelector('#redTeamScan'), '::after').animationName",
    returnByValue: true,
  });
  viewportAudits.push({ ...reduced, reducedMotion: true, optionalAnimation: motion.result.value });
}
await send('Emulation.setEmulatedMedia', { features: [] });

const report = { capturedAt: new Date().toISOString(), captures: captureAudits, viewports: viewportAudits };
await writeFile(path.join(outputRoot, 'browser-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
socket.close();

const failures = [...captureAudits, ...viewportAudits].filter(item =>
  item.horizontalOverflow !== 0 || item.modalOverflow !== 0 || item.consoleErrors.length || !item.actionReachable ||
  !item.modalOpen || item.proof !== 'verified' || !item.focusContained || !item.contractBoundaryTruthful || item.presetCount !== 9 || !item.evidenceVisible ||
  (item.reducedMotion && (item.optionalAnimation !== 'none' || item.lastDecision !== 'APPROVE'))
);
if (failures.length) throw new Error(`Red Team browser audit failed: ${failures.map(item => item.label).join(', ')}`);
process.stdout.write(`Captured ${captureAudits.length} Red Team views and audited ${viewportAudits.length} viewports with zero overflow or console errors.\n`);
