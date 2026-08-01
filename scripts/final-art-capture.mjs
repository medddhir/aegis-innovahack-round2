import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [baseUrl = 'http://localhost:4174/', outputRoot] = process.argv.slice(2);
if (!outputRoot) throw new Error('Usage: final-art-capture.mjs <baseUrl> <outputDirectory>');

const captures = [
  ['01-final-hero-1440x900.png', '', 1440, 900, 1600],
  ['02-final-hero-1280x720.png', '', 1280, 720, 1600],
  ['03-aegis-instrument-close-up.png', 'core', 1440, 900, 1700],
  ['04-authority-chapter.png', 'authority', 1440, 900, 1600],
  ['05-control-centre.png', 'control', 1440, 900, 1600],
  ['06-valid-transaction.png', 'judge-approved', 1440, 900, 1700],
  ['07-oversized-block.png', 'judge-blocked', 1440, 900, 1700],
  ['08-evasion-shield.png', 'evasion', 1440, 900, 1700],
  ['09-pending-settlement.png', 'pending', 1440, 900, 1700],
  ['10-owner-kill-switch.png', 'kill', 1440, 900, 1900],
  ['11-policy-digital-twin.png', 'twin', 1440, 900, 2000],
  ['12-forensic-proof.png', 'forensics', 1440, 900, 2000],
  ['13-contract-proof.png', 'proof', 1440, 900, 1600],
  ['14-mobile-hero.png', '', 390, 844, 1600],
  ['15-mobile-judge-mode.png', 'mobile-judge', 390, 844, 1900],
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
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') {
    runtimeErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Runtime exception');
  }
  if (message.method === 'Log.entryAdded' && message.params.entry?.level === 'error') {
    runtimeErrors.push(message.params.entry.text);
  }
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

await mkdir(outputRoot, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const audits = [];
for (const [filename, mode, width, height, waitMs] of captures) {
  const mobile = width < 768;
  await send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: { type: mobile ? 'portraitPrimary' : 'landscapePrimary', angle: 0 },
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  const url = new URL(baseUrl);
  if (mode) url.searchParams.set('capture', mode);
  else url.searchParams.set('captureSet', filename);
  runtimeErrors = [];
  await send('Page.navigate', { url: url.toString() });
  runtimeErrors = [];
  await wait(waitMs);
  const auditResult = await send('Runtime.evaluate', {
    expression: `JSON.stringify({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      modalOverflow: (document.querySelector('#judgeCard')?.scrollWidth || 0) - (document.querySelector('#judgeCard')?.clientWidth || 0),
      proof: document.documentElement.dataset.contractProof || null,
      renderer: document.querySelector('#magicRingsMount')?.dataset.rendererState || null,
      judgeOpen: !document.querySelector('#judgeModal')?.classList.contains('hidden'),
      judgeAction: document.querySelector('#judgeNext')?.textContent.trim() || null,
      judgeActionReachable: (() => { const open = !document.querySelector('#judgeModal')?.classList.contains('hidden'); const r = document.querySelector('#judgeNext')?.getBoundingClientRect(); return !open || !r || (r.width > 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight); })(),
      regulatory: document.querySelector('footer .legal')?.textContent.includes('simulated/test funds') || false
    })`,
    returnByValue: true,
  });
  await send('Runtime.evaluate', { expression: "document.querySelector('#toast')?.classList.remove('show')" });
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(outputRoot, filename), Buffer.from(screenshot.data, 'base64'));
  audits.push({ filename, width, height, mode: mode || 'hero', ...JSON.parse(auditResult.result.value), consoleErrors: [...runtimeErrors] });
}

await writeFile(path.join(outputRoot, 'browser-audit.json'), `${JSON.stringify(audits, null, 2)}\n`);
const failed = audits.filter(audit => audit.overflow !== 0 || audit.modalOverflow !== 0 || audit.consoleErrors.length || !audit.judgeActionReachable || audit.proof !== 'verified');
socket.close();
if (failed.length) throw new Error(`Browser audit failed: ${failed.map(audit => audit.filename).join(', ')}`);
process.stdout.write(`Captured ${audits.length} views with zero horizontal overflow and zero console errors.\n`);
