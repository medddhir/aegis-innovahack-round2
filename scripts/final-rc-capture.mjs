import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [baseUrl = 'http://localhost:4197/', outputRoot, requestedPort = '9223'] = process.argv.slice(2);
if (!outputRoot) throw new Error('Usage: final-rc-capture.mjs <baseUrl> <outputDirectory> [cdpPort]');
const cdpPort = Number(requestedPort);
const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const page = pages.find(candidate => candidate.type === 'page');
if (!page) throw new Error(`No Chrome page target is available on port ${cdpPort}.`);
const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let sequence = 0;
let captureMode = '';
let delayedRequest = null;
let runtimeErrors = [];
const pending = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++sequence;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

function recommendationFor(postData = '{}') {
  const incident = JSON.parse(postData);
  const policy = incident.policy;
  const evidence = incident.evidence ?? [];
  return {
    incident_summary: 'The deterministic evidence shows repeated simulated attempts against an active policy boundary.',
    attack_classification: 'POLICY_BOUNDARY_PROBING',
    severity: 'HIGH',
    evidence_sufficient: true,
    evidence_ids: evidence.slice(0, 3).map(item => item.id),
    decisive_rules: [...new Set(evidence.slice(0, 3).map(item => item.decisive_rule))],
    recommended_patch: {
      per_transaction_limit_paise: Math.max(1, policy.per_transaction_limit_paise - 10_000),
      settlement_delay_seconds: policy.settlement_delay_seconds + 5,
    },
    change_required: true,
    rationale: 'Narrowing transaction authority and extending final revalidation preserves the existing owner boundary while reducing exposure.',
    human_approval_required: true,
    confidence: 0.91,
    limitations: ['Simulated Aegis evidence only.', 'Human review remains mandatory.'],
  };
}

async function fulfillSentinel(requestId, postData, unavailable = false) {
  const body = unavailable
    ? { ok: false, error: 'SENTINEL_UNAVAILABLE', message: 'Advisory analysis is currently unavailable. Deterministic Aegis enforcement remains operational.' }
    : { ok: true, recommendation: recommendationFor(postData) };
  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: unavailable ? 503 : 200,
    responseHeaders: [{ name: 'content-type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify(body)).toString('base64'),
  });
}

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
  if (message.method === 'Fetch.requestPaused') {
    const request = message.params.request;
    if (!request.url.includes('/api/lyzr-sentinel')) return void send('Fetch.continueRequest', { requestId: message.params.requestId });
    if (captureMode === 'sentinel-loading') delayedRequest = { requestId: message.params.requestId, postData: request.postData };
    else void fulfillSentinel(message.params.requestId, request.postData, captureMode === 'sentinel-unavailable');
  }
});

await mkdir(outputRoot, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Fetch.enable', { patterns: [{ urlPattern: '*://*/api/lyzr-sentinel', requestStage: 'Request' }] });

async function viewport(width, height, reduced = false) {
  const mobile = width < 768;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height, screenOrientation: { type: mobile ? 'portraitPrimary' : 'landscapePrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
}

async function setTheme(theme) {
  await send('Page.navigate', { url: baseUrl });
  await wait(250);
  await evaluate(`localStorage.setItem('aegis-theme',${JSON.stringify(theme)});sessionStorage.setItem('aegis-intro-seen','1')`);
}

async function navigate(search = '') {
  runtimeErrors = [];
  delayedRequest = null;
  const url = new URL(baseUrl);
  const parameters = new URLSearchParams(search);
  for (const [key, value] of parameters) url.searchParams.set(key, value);
  await send('Page.navigate', { url: url.toString() });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const ready = await evaluate("document.readyState==='complete'&&Boolean(window.__AEGIS_DIAGNOSTICS__?.engine)&&Boolean(window.__AEGIS_SENTINEL__)&&document.documentElement.dataset.contractProof==='verified'");
    if (ready) return;
    await wait(100);
  }
  throw new Error(`Release-candidate page did not become ready: ${url}`);
}

async function screenshot(file, { width = 1440, height = 900, reduced = false, theme = 'command', search = '', waitMs = 900, action = '' } = {}) {
  captureMode = new URLSearchParams(search).get('rcCapture') ?? '';
  await viewport(width, height, reduced);
  await setTheme(theme);
  await navigate(search);
  if (action) await evaluate(action);
  await wait(waitMs);
  const auditedErrors = captureMode === 'sentinel-unavailable' ? runtimeErrors.filter(message => !message.includes('503 (Service Unavailable)')) : runtimeErrors;
  const audit = JSON.parse(await evaluate(`JSON.stringify({overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,theme:document.documentElement.dataset.theme,proof:document.documentElement.dataset.contractProof,sentinelOpen:Boolean(document.querySelector('#sentinelDialog')?.open),errors:${JSON.stringify(auditedErrors)}})`));
  if (audit.overflow !== 0 || audit.proof !== 'verified' || audit.errors.length || (captureMode.startsWith('sentinel-') && !audit.sentinelOpen)) throw new Error(`${file} browser audit failed: ${JSON.stringify(audit)}`);
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(outputRoot, file), Buffer.from(image.data, 'base64'));
  if (delayedRequest) {
    await fulfillSentinel(delayedRequest.requestId, delayedRequest.postData);
    delayedRequest = null;
  }
  return { file, ...audit };
}

async function sentinelAction(mode, mobile = false) {
  const operations = [
    "const later=ms=>new Promise(resolve=>setTimeout(resolve,ms))",
    "for(let index=sessionStorage.length-1;index>=0;index-=1){const key=sessionStorage.key(index);if(key?.startsWith('aegis-sentinel-cache:'))sessionStorage.removeItem(key)}",
    "document.querySelector('[data-scenario=\"overspend\"]')?.click()",
    'await later(180)',
    "document.querySelector('[data-sentinel-context=\"FORENSIC_PROOF_LEDGER\"]')?.click()",
    'await later(120)',
  ];
  if (mode !== 'idle') operations.push("document.querySelector('#sentinelAsk')?.click()", 'await later(420)');
  if (mode === 'simulation') operations.push("document.querySelector('#sentinelSimulate')?.click()", 'await later(160)');
  operations.push(`return ${mobile ? 'innerWidth' : 'true'}`);
  return `(async()=>{${operations.join(';')}})()`;
}

const records = [];
records.push(await screenshot('01-logo-command-mode.png'));
records.push(await screenshot('02-logo-research-mode.png', { theme: 'research' }));

async function bootFrame(file, waitMs) {
  await viewport(1440, 900, false);
  await setTheme('command');
  captureMode = '';
  const url = new URL(baseUrl); url.searchParams.set('intro', '1');
  await send('Page.navigate', { url: url.toString() });
  await wait(waitMs);
  const image = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(outputRoot, file), Buffer.from(image.data, 'base64'));
  records.push({ file, startupFrame: waitMs });
}
await bootFrame('03-startup-frame-1.png', 90);
await bootFrame('04-startup-midpoint.png', 650);
await bootFrame('05-startup-completed.png', 1550);

records.push(await screenshot('06-research-mode-hero.png', { theme: 'research' }));
records.push(await screenshot('07-research-mode-control-centre.png', { theme: 'research', search: 'capture=control', waitMs: 1100 }));
records.push(await screenshot('08-research-mode-judge-mode.png', { theme: 'research', search: 'capture=judge-approved', waitMs: 2100 }));
records.push(await screenshot('09-research-mode-red-team-lab.png', { theme: 'research', search: 'capture=red-compliant', waitMs: 1500 }));
records.push(await screenshot('10-research-mode-forensics.png', { theme: 'research', search: 'capture=forensics', waitMs: 1800 }));
records.push(await screenshot('11-sentinel-idle.png', { search: 'rcCapture=sentinel-idle', action: await sentinelAction('idle'), waitMs: 250 }));
records.push(await screenshot('12-sentinel-loading.png', { search: 'rcCapture=sentinel-loading', action: await sentinelAction('loading'), waitMs: 80 }));
records.push(await screenshot('13-sentinel-recommendation.png', { search: 'rcCapture=sentinel-recommendation', action: await sentinelAction('recommendation'), waitMs: 250 }));
records.push(await screenshot('14-digital-twin-recommendation-simulation.png', { search: 'rcCapture=sentinel-simulation', action: await sentinelAction('simulation'), waitMs: 250 }));
records.push(await screenshot('15-lyzr-unavailable.png', { search: 'rcCapture=sentinel-unavailable', action: await sentinelAction('unavailable'), waitMs: 250 }));
records.push(await screenshot('16-mobile-command-mode.png', { width: 390, height: 844 }));
records.push(await screenshot('17-mobile-research-mode.png', { width: 390, height: 844, theme: 'research' }));
records.push(await screenshot('18-mobile-sentinel.png', { width: 390, height: 844, search: 'rcCapture=sentinel-recommendation', action: await sentinelAction('recommendation', true), waitMs: 250 }));
records.push(await screenshot('19-projector-1280x720.png', { width: 1280, height: 720 }));

const imageData = await Promise.all(records.map(async record => ({ file: record.file, data: (await readFile(path.join(outputRoot, record.file))).toString('base64') })));
const contactHtml = `<!doctype html><style>html,body{margin:0;background:#04090e;color:#dcecf5;font:12px Arial}main{display:grid;grid-template-columns:repeat(4,320px);gap:10px;padding:10px}figure{margin:0;padding:6px;background:#09131b;border:1px solid #1a3345}img{display:block;width:306px;height:188px;object-fit:cover;object-position:top}figcaption{padding:6px 2px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><main>${imageData.map(image => `<figure><img src="data:image/png;base64,${image.data}"><figcaption>${image.file}</figcaption></figure>`).join('')}</main>`;
const frame = (await send('Page.getFrameTree')).frameTree.frame.id;
await send('Page.setDocumentContent', { frameId: frame, html: contactHtml });
await wait(500);
const size = JSON.parse(await evaluate("JSON.stringify({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})"));
await send('Emulation.setDeviceMetricsOverride', { width: Math.min(1320, size.width), height: Math.min(2000, size.height), deviceScaleFactor: 1, mobile: false });
const contact = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } });
await writeFile(path.join(outputRoot, '20-contact-sheet.png'), Buffer.from(contact.data, 'base64'));

const logo = await readFile(new URL('../public/aegis-logo.svg', import.meta.url), 'utf8');
const wordmark = await readFile(new URL('../public/aegis-wordmark.svg', import.meta.url), 'utf8');
const data = value => `data:image/svg+xml;base64,${Buffer.from(value).toString('base64')}`;
const brandHtml = `<!doctype html><style>body{margin:0;background:#071019;color:#eef8fb;font:14px Arial;padding:34px}h1{font-size:22px}.row{display:flex;gap:36px;align-items:end;margin:28px 0}.tile{padding:22px;border:1px solid #274052;background:#0b1721}.light{background:#eee8dc;color:#14242d}.header{display:flex;align-items:center;gap:12px;width:520px}.label{display:block;margin-top:10px;color:#8aa0ad}.light .label{color:#536a76}.logo,.word{display:block;background:currentColor;mask:var(--asset) center/contain no-repeat;-webkit-mask:var(--asset) center/contain no-repeat}.logo{--asset:url('${data(logo)}');color:#58c8ef}.word{--asset:url('${data(wordmark)}');color:#ecf8fb}.light .logo{color:#086f9e}.light .word{color:#14242d}</style><h1>AEGIS ORIGINAL IDENTITY · RELEASE CANDIDATE</h1><div class="row"><div class="tile"><i class="logo" style="width:16px;height:16px"></i><span class="label">16 PX</span></div><div class="tile"><i class="logo" style="width:32px;height:32px"></i><span class="label">32 PX</span></div><div class="tile"><i class="logo" style="width:64px;height:64px"></i><span class="label">64 PX</span></div><div class="tile header"><i class="logo" style="width:32px;height:36px"></i><i class="word" style="width:94px;height:28px"></i><span class="label">COMMAND MODE HEADER</span></div></div><div class="row"><div class="tile light"><i class="logo" style="width:64px;height:64px"></i><span class="label">RESEARCH MODE</span></div><div class="tile light header"><i class="logo" style="width:32px;height:36px"></i><i class="word" style="width:94px;height:28px"></i><span class="label">RESEARCH MODE HEADER</span></div><div class="tile"><i class="logo" style="width:48px;height:48px"></i><span class="label">FAVICON SIMULATION</span></div></div>`;
await send('Page.setDocumentContent', { frameId: frame, html: brandHtml });
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 560, deviceScaleFactor: 1, mobile: false });
await wait(300);
const brand = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
const brandRoot = path.resolve(outputRoot, '..', 'brand');
await mkdir(brandRoot, { recursive: true });
await writeFile(path.join(brandRoot, 'logo-review-sheet.png'), Buffer.from(brand.data, 'base64'));
await writeFile(path.join(outputRoot, 'browser-audit.json'), `${JSON.stringify({ capturedAt: new Date().toISOString(), records }, null, 2)}\n`);
socket.close();
process.stdout.write(`Captured ${records.length} release-candidate views, contact sheet, and logo review sheet with zero overflow or console errors.\n`);
