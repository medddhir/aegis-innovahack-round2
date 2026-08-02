import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [baseUrl = 'http://localhost:4184/', outputRoot, requestedPort = '9224'] = process.argv.slice(2);
if (!outputRoot) throw new Error('Usage: final-ux-capture.mjs <baseUrl> <outputDirectory>');
const cdpPort = Number(requestedPort);

const captures = [
  { file: '01-hero-initial.png', width: 1440, height: 900, wait: 900 },
  { file: '02-hero-departure.png', width: 1440, height: 900, wait: 500, action: "scrollTo(0,document.querySelector('#thesis').offsetHeight*.56)" },
  { file: '03-threat-thesis-reveal.png', width: 1440, height: 900, wait: 1100, mode: 'threat' },
  { file: '04-sticky-authority-stage-1.png', width: 1440, height: 900, wait: 650, action: "document.querySelector('[data-policy-step=\"1\"]').scrollIntoView({block:'center'})" },
  { file: '05-sticky-authority-final-stage.png', width: 1440, height: 900, wait: 650, action: "document.querySelector('[data-policy-step=\"5\"]').scrollIntoView({block:'center'})" },
  { file: '06-intervention-oversized-block.png', width: 1440, height: 900, wait: 1500, mode: 'attack-theatre' },
  { file: '07-intervention-evasion-shield.png', width: 1440, height: 900, wait: 1800, mode: 'evasion' },
  { file: '08-intervention-pending-settlement.png', width: 1440, height: 900, wait: 1700, mode: 'pending' },
  { file: '09-intervention-kill-switch.png', width: 1440, height: 900, wait: 2100, mode: 'kill' },
  { file: '10-control-centre-entering.png', width: 1440, height: 900, wait: 110, action: "scrollTo(0,document.querySelector('#control-centre').offsetTop-innerHeight*.72)" },
  { file: '11-control-centre-settled.png', width: 1440, height: 900, wait: 1000, mode: 'control' },
  { file: '12-red-team-lab-entrance.png', width: 1440, height: 900, wait: 230, mode: 'red-empty' },
  { file: '13-red-team-lab-custom-attempt.png', width: 1440, height: 900, wait: 1000, mode: 'red-compliant' },
  { file: '14-proof-tracing-midpoint.png', width: 1440, height: 900, wait: 700, action: "scrollTo(0,document.querySelector('#proof').offsetTop+document.querySelector('#proof').offsetHeight*.38)" },
  { file: '15-proof-tracing-complete.png', width: 1440, height: 900, wait: 700, action: "document.querySelector('#contract-enforcement').scrollIntoView({block:'center'})" },
  { file: '16-digital-twin-comparison.png', width: 1440, height: 900, wait: 2100, mode: 'twin' },
  { file: '17-forensic-collapsed.png', width: 1440, height: 900, wait: 1900, mode: 'forensics' },
  { file: '18-forensic-expanded.png', width: 1440, height: 900, wait: 2050, mode: 'forensics', action: "document.querySelector('.ux-forensic-disclosure')?.setAttribute('open','')" },
  { file: '19-floating-navigation.png', width: 1280, height: 720, wait: 700, action: "document.querySelector('#authority').scrollIntoView({block:'start'})" },
  { file: '20-mobile-chapter-flow.png', width: 390, height: 844, wait: 700, action: "document.querySelector('#threat').scrollIntoView({block:'start'})" },
  { file: '21-mobile-red-team-lab.png', width: 390, height: 844, wait: 850, mode: 'red-empty' },
  { file: '22-reduced-motion-page.png', width: 1280, height: 720, wait: 650, reduced: true, action: "document.querySelector('#authority').scrollIntoView({block:'start'})" },
];

const requiredViewports = [[1440, 900], [1280, 720], [1024, 768], [768, 1024], [430, 932], [390, 844], [360, 800]];
const pages = await fetch(`http://127.0.0.1:${cdpPort}/json`).then(response => response.json());
const page = pages.find(candidate => candidate.type === 'page');
if (!page) throw new Error(`No Chrome page target is available on port ${cdpPort}.`);
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
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
};

async function setViewport(width, height, reduce = false) {
  const mobile = width < 768;
  await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height, screenOrientation: { type: mobile ? 'portraitPrimary' : 'landscapePrimary', angle: 0 } });
  await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduce ? 'reduce' : 'no-preference' }] });
}

async function navigate(mode = null) {
  runtimeErrors = [];
  const url = new URL(baseUrl);
  if (mode) url.searchParams.set('capture', mode);
  await send('Page.navigate', { url: url.toString() });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const ready = await evaluate("Boolean(window.UxScrollController?.diagnostics().initialized && window.__AEGIS_DIAGNOSTICS__?.engine && document.documentElement.dataset.contractProof === 'verified')");
    if (ready) {
      if (!mode?.startsWith('red-') || await evaluate("!document.querySelector('#redTeamModal').classList.contains('hidden')")) return;
    }
    await wait(100);
  }
  throw new Error(`UX runtime did not become ready for ${mode || 'page'}.`);
}

async function audit(label, width, height, reduced = false) {
  const result = JSON.parse(await evaluate(`JSON.stringify((()=>{
    const ux=window.UxScrollController.diagnostics();
    const redAction=document.querySelector('#redTeamSubmit')?.getBoundingClientRect();
    const judgeAction=document.querySelector('#judgeNext')?.getBoundingClientRect();
    const visible=e=>e&&getComputedStyle(e).display!=='none'&&getComputedStyle(e).visibility!=='hidden';
    const clipped=[...document.querySelectorAll('h1,h2,h3,.judge-result,.red-team-result')].filter(visible).filter(e=>e.scrollWidth-e.clientWidth>2).length;
    return {
      label:${JSON.stringify(label)},width:${width},height:${height},reduced:${reduced},
      horizontalOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      currentChapter:ux.currentChapter,triggerCount:ux.triggerCount,pinnedTriggers:ux.pinnedTriggers,scrubbedTriggers:ux.scrubbedTriggers,
      paused:ux.paused,clippedCriticalText:clipped,
      pinReleased:getComputedStyle(document.querySelector('#storyFlow')).position!=='fixed',
      redActionReachable:document.querySelector('#redTeamModal').classList.contains('hidden')||!!redAction&&redAction.width>=44&&redAction.height>=44&&redAction.left>=0&&redAction.right<=innerWidth&&redAction.bottom<=innerHeight,
      judgeActionReachable:document.querySelector('#judgeModal').classList.contains('hidden')||!!judgeAction&&judgeAction.width>=44&&judgeAction.left>=0&&judgeAction.right<=innerWidth,
      copyLockSource:document.querySelector('#thesisTitle')?.textContent.includes('Aegis makes disobedience financially impossible.'),
      proofTruthful:document.documentElement.dataset.contractProof==='verified'&&document.querySelector('[data-contract-field="environment"]')?.textContent.includes('LOCAL'),
      consoleErrors:${JSON.stringify(runtimeErrors)}
    };
  })())`));
  return result;
}

await mkdir(outputRoot, { recursive: true });
await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Network.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });

const screenshotAudits = [];
const imageData = [];
for (const capture of captures) {
  await setViewport(capture.width, capture.height, Boolean(capture.reduced));
  await navigate(capture.mode);
  if (capture.action) await evaluate(capture.action);
  await wait(capture.wait);
  const record = await audit(capture.file, capture.width, capture.height, Boolean(capture.reduced));
  const screenshot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.join(outputRoot, capture.file), Buffer.from(screenshot.data, 'base64'));
  imageData.push({ file: capture.file, data: screenshot.data });
  screenshotAudits.push(record);
}

const viewportAudits = [];
for (const [width, height] of requiredViewports) {
  await setViewport(width, height, false);
  await navigate();
  await evaluate("document.querySelector('#control-centre').scrollIntoView({block:'start'})");
  await wait(500);
  viewportAudits.push(await audit(`${width}x${height}`, width, height));
}

await setViewport(1280, 720, false);
await navigate();
const orchestration = JSON.parse(await evaluate(`(async()=>{
  document.documentElement.style.scrollBehavior='auto';
  const engineBefore=JSON.stringify(window.__AEGIS_DIAGNOSTICS__.engine());
  const ledgerBefore=window.__AEGIS_DIAGNOSTICS__.ledger().length;
  const initial=window.UxScrollController.diagnostics();
  for(const target of ['#threat','#authority','#intervention','#control-centre','#proof','#contract-enforcement','#policy-network']){
    document.querySelector(target).scrollIntoView({block:'start'});await new Promise(r=>setTimeout(r,70));
  }
  scrollTo({top:document.documentElement.scrollHeight,behavior:'instant'});await new Promise(r=>setTimeout(r,650));
  const fastScroll=window.UxScrollController.diagnostics();
  const pinReleased=getComputedStyle(document.querySelector('#storyFlow')).position!=='fixed';
  scrollTo({top:document.querySelector('#threat').offsetTop,behavior:'instant'});await new Promise(r=>setTimeout(r,260));
  const beforeModal=window.UxScrollController.diagnostics();const restoreY=scrollY;
  document.querySelector('[data-open-red-team]').click();await new Promise(r=>setTimeout(r,220));
  const redPaused=window.UxScrollController.diagnostics().paused;
  document.querySelector('#redTeamClose').click();await new Promise(r=>setTimeout(r,520));
  const afterRed=window.UxScrollController.diagnostics();const redRestored=Math.abs(scrollY-restoreY)<5;
  document.querySelector('#launchJudgeMode').click();await new Promise(r=>setTimeout(r,180));
  const judgePaused=window.UxScrollController.diagnostics().paused;
  document.querySelector('#closeJudgeMode').click();await new Promise(r=>setTimeout(r,520));
  const afterJudge=window.UxScrollController.diagnostics();const judgeRestored=Math.abs(scrollY-restoreY)<5;
  window.UxScrollController.refresh();window.UxScrollController.refresh();await new Promise(r=>setTimeout(r,180));
  const afterRefresh=window.UxScrollController.diagnostics();
  const ids=window.ScrollTrigger.getAll().map(t=>t.vars.id).filter(Boolean);
  window.UxScrollController.destroy();const destroyed=window.ScrollTrigger.getAll().length;
  window.UxScrollController.init();await new Promise(r=>setTimeout(r,220));
  return JSON.stringify({
    engineStable:engineBefore===JSON.stringify(window.__AEGIS_DIAGNOSTICS__.engine()),ledgerStable:ledgerBefore===window.__AEGIS_DIAGNOSTICS__.ledger().length,
    initial,fastScroll,pinReleased,redPaused,judgePaused,redRestored,judgeRestored,
    triggerStable:afterRed.triggerCount<=beforeModal.triggerCount&&afterJudge.triggerCount<=beforeModal.triggerCount&&afterRefresh.triggerCount===afterJudge.triggerCount,
    uniqueTriggerIds:new Set(ids).size===ids.length,destroyed,restored:window.UxScrollController.diagnostics()
  });
})()`));

await setViewport(390, 844, true);
await navigate();
const reducedAudit = await audit('390x844-reduced-motion', 390, 844, true);
viewportAudits.push(reducedAudit);

const contactHtml = `<!doctype html><style>html,body{margin:0;background:#03070b;color:#dcecf5;font:12px Arial}main{display:grid;grid-template-columns:repeat(4,320px);gap:12px;padding:12px}figure{margin:0;padding:7px;background:#08121a;border:1px solid #183247}img{display:block;width:306px;height:191px;object-fit:cover;object-position:top}figcaption{padding:7px 2px 1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}</style><main>${imageData.map(image => `<figure><img src="data:image/png;base64,${image.data}"><figcaption>${image.file}</figcaption></figure>`).join('')}</main>`;
await send('Page.setDocumentContent', { frameId: (await send('Page.getFrameTree')).frameTree.frame.id, html: contactHtml });
await wait(600);
const contactSize = JSON.parse(await evaluate("JSON.stringify({width:document.documentElement.scrollWidth,height:document.documentElement.scrollHeight})"));
await send('Emulation.setDeviceMetricsOverride', { width: Math.min(1400, contactSize.width), height: Math.min(2000, contactSize.height), deviceScaleFactor: 1, mobile: false });
const contact = await send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { x: 0, y: 0, width: contactSize.width, height: contactSize.height, scale: 1 } });
await writeFile(path.join(outputRoot, 'contact-sheet.png'), Buffer.from(contact.data, 'base64'));

const report = { capturedAt: new Date().toISOString(), screenshots: screenshotAudits, viewports: viewportAudits, orchestration };
await writeFile(path.join(outputRoot, 'browser-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
socket.close();

const visualFailures = [...screenshotAudits, ...viewportAudits].filter(item => item.horizontalOverflow !== 0 || item.clippedCriticalText !== 0 || item.consoleErrors.length || !item.redActionReachable || !item.judgeActionReachable || !item.copyLockSource || !item.proofTruthful || (item.reduced && (item.pinnedTriggers !== 0 || item.scrubbedTriggers !== 0)));
const orchestrationFailures = Object.entries({ engineStable: orchestration.engineStable, ledgerStable: orchestration.ledgerStable, pinReleased: orchestration.pinReleased, redPaused: orchestration.redPaused, judgePaused: orchestration.judgePaused, redRestored: orchestration.redRestored, judgeRestored: orchestration.judgeRestored, triggerStable: orchestration.triggerStable, uniqueTriggerIds: orchestration.uniqueTriggerIds, destroyed: orchestration.destroyed === 0 }).filter(([, pass]) => !pass);
if (visualFailures.length || orchestrationFailures.length) throw new Error(`Final UX audit failed: ${visualFailures.map(item => item.label).join(', ')} ${orchestrationFailures.map(([name]) => name).join(', ')}`);
process.stdout.write(`Captured ${screenshotAudits.length} final UX views; audited ${viewportAudits.length} viewport states with stable engine, ledger, triggers, modals, and zero console errors.\n`);
