import { writeFile } from 'node:fs/promises';

const [url, widthValue, heightValue, outputPath, waitValue = '1800'] = process.argv.slice(2);
if (!url || !widthValue || !heightValue) throw new Error('Usage: cdp-capture.mjs <url> <width> <height> [output.png] [waitMs]');

const width = Number(widthValue);
const height = Number(heightValue);
const waitMs = Number(waitValue);
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
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (!message.id || !pending.has(message.id)) return;
  const { resolve, reject } = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) reject(new Error(message.error.message));
  else resolve(message.result);
});

const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
const browserErrors = [];
socket.addEventListener('message', event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Runtime.exceptionThrown') {
    const detail = message.params.exceptionDetails;
    browserErrors.push(detail?.exception?.description || `${detail?.text || 'Runtime exception'} @ ${detail?.url || 'unknown'}:${detail?.lineNumber ?? 0}`);
  }
  if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry?.level)) {
    browserErrors.push(message.params.entry.text);
  }
});
const isMobile = width < 768;
await send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 1,
  mobile: isMobile,
  screenWidth: width,
  screenHeight: height,
  screenOrientation: { type: isMobile ? 'portraitPrimary' : 'landscapePrimary', angle: 0 },
});
await send('Emulation.setTouchEmulationEnabled', { enabled: isMobile, maxTouchPoints: isMobile ? 5 : 1 });
await send('Page.navigate', { url });
browserErrors.length = 0;
await new Promise(resolve => setTimeout(resolve, waitMs));

const auditResult = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    viewport:{width:innerWidth,height:innerHeight},
    pageOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
    modalOverflow:(document.querySelector('#judgeCard')?.scrollWidth||0)-(document.querySelector('#judgeCard')?.clientWidth||0),
    audit:document.querySelector('#aegis-browser-audit')?.textContent||null,
    browserErrors:${JSON.stringify(browserErrors)},
    contractProof:document.documentElement.dataset.contractProof||null,
    contractTests:document.querySelector('[data-contract-field="tests"]')?.textContent.trim()||null,
    ringRenderer:document.querySelector('#magicRingsMount')?.dataset.rendererState||null,
    action:document.querySelector('#judgeNext')?.textContent.trim()||null,
    actionRect:(()=>{const r=document.querySelector('#judgeNext')?.getBoundingClientRect();return r?{left:r.left,right:r.right,width:r.width}:null})(),
    regions:Object.fromEntries(['#judgeCard','.judge-body','.judge-context','.judge-execution','.judge-proof'].map(s=>{const e=document.querySelector(s),r=e?.getBoundingClientRect();return [s,r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height,order:getComputedStyle(e).order}:null]}))
  })`,
  returnByValue: true,
});
const audit = JSON.parse(auditResult.result.value);

if (outputPath) {
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(outputPath, Buffer.from(screenshot.data, 'base64'));
}

console.log(JSON.stringify(audit));
socket.close();
