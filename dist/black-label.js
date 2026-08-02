const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileMode = () => window.matchMedia('(max-width: 760px), (pointer: coarse)').matches;

const runtime = {
  visibleZones: new Set(),
  wordTimer: null,
  suiteTimers: [],
  typingTimer: null,
  scrollFrame: null,
};

function safeStorageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* The theme still works for this session. */ }
}

function applyTheme(theme, { persist = false } = {}) {
  const research = theme === 'research';
  document.documentElement.dataset.theme = research ? 'research' : 'command';
  document.documentElement.style.colorScheme = research ? 'light' : 'dark';
  const toggle = $('#themeToggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(research));
    toggle.setAttribute('aria-label', research ? 'Switch to Command Mode' : 'Switch to Research Mode');
    const label = $('b', toggle);
    if (label) label.textContent = research ? 'RESEARCH' : 'COMMAND';
  }
  if (persist) safeStorageSet('aegis-theme', research ? 'research' : 'command');
}

function initTheme() {
  applyTheme(safeStorageGet('aegis-theme') === 'research' ? 'research' : 'command');
  $('#themeToggle')?.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'research' ? 'command' : 'research';
    applyTheme(next, { persist: true });
  });
}

function initSectionActivity() {
  const zones = [$('#heroFlow'), ...$$('[data-zone]')].filter(Boolean);
  if (reduceMotion() || !('IntersectionObserver' in window)) {
    zones.forEach(zone => { zone.dataset.componentActive = 'true'; });
    return;
  }
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      entry.target.dataset.componentActive = String(entry.isIntersecting);
      if (entry.isIntersecting) runtime.visibleZones.add(entry.target);
      else runtime.visibleZones.delete(entry.target);
    });
  }, { rootMargin: '80px 0px', threshold: .08 });
  zones.forEach(zone => observer.observe(zone));
}

function initWordRotate() {
  const output = $('#wordRotate');
  if (!output || reduceMotion()) return;
  const words = ['AUTHORISE', 'CONSTRAIN', 'REVOKE', 'PROVE'];
  let index = 0;
  const rotate = () => {
    if ($('#heroFlow')?.dataset.componentActive !== 'true' || document.hidden) return;
    output.classList.add('out');
    window.setTimeout(() => {
      index = (index + 1) % words.length;
      output.textContent = words[index];
      output.classList.remove('out');
    }, 160);
  };
  runtime.wordTimer = window.setInterval(rotate, 2200);
}

function initSpecularPointer() {
  const button = $('#launchJudgeMode');
  if (!button || reduceMotion() || mobileMode()) return;
  button.addEventListener('pointermove', event => {
    const rect = button.getBoundingClientRect();
    button.style.setProperty('--specular-x', `${event.clientX - rect.left - 45}px`);
  });
  button.addEventListener('pointerleave', () => button.style.setProperty('--specular-x', '-90px'));
}

function actualThreatEvidence() {
  const outcome = $('#storyOutcome')?.textContent?.trim() || 'UNVERIFIED';
  const rule = $('#storyRule')?.textContent?.trim() || 'AWAITING_ANALYSIS';
  const transaction = $('#storyTransaction')?.textContent?.trim() || '₹0 · simulated';
  const scan = $('#threatScan');
  if (!scan) return;
  $('#threatDecision').textContent = outcome;
  $('#threatRule').textContent = rule;
  $('#threatIntent').textContent = transaction;
  const blocked = /BLOCK|INVALID|FROZEN|RESTRICT/i.test(outcome);
  scan.dataset.analysis = blocked ? 'blocked' : /APPROV|SETTLED|PENDING|HOLD/i.test(outcome) ? 'complete' : 'idle';
  const rules = $$('.scan-rules span', scan);
  rules.forEach(ruleNode => ruleNode.classList.remove('pass', 'fail'));
  const failMap = { AGENT: 0, TASK: 1, RECIPIENT: 2, ALLOWLIST: 2, TRANSACTION: 3, LIMIT: 3, BUDGET: 3, EVASION: 4, RISK: 4, FROZEN: 4 };
  const failIndex = Object.entries(failMap).find(([token]) => rule.includes(token))?.[1];
  rules.forEach((node, index) => {
    if (blocked && index === failIndex) node.classList.add('fail');
    else if (failIndex === undefined || index < failIndex) node.classList.add('pass');
  });
  if (blocked) {
    const glitch = $('#threatDecision');
    glitch.classList.remove('letter-glitch-event');
    void glitch.offsetWidth;
    if (!reduceMotion()) glitch.classList.add('letter-glitch-event');
  }
}

function runThreatScan() {
  const scan = $('#threatScan');
  const source = $('[data-story-scenario="overspend"]');
  if (!scan || !source) return;
  scan.dataset.analysis = 'running';
  $('#threatDecision').textContent = 'EVALUATING';
  source.click();
  window.setTimeout(actualThreatEvidence, reduceMotion() ? 0 : 380);
}

function initThreatZone() {
  $('#scanThreat')?.addEventListener('click', runThreatScan);
  const observed = $('#storyOutcome');
  if (observed) new MutationObserver(actualThreatEvidence).observe(observed, { childList: true, subtree: true, characterData: true });
  const revealNodes = [$('#threatTitle'), $('.threat-thesis')].filter(Boolean);
  if (reduceMotion() || !('IntersectionObserver' in window)) revealNodes.forEach(node => node.classList.add('is-revealed'));
  else {
    $('#threatTitle')?.classList.add('reveal-ready');
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('is-revealed'); observer.unobserve(entry.target); }
    }), { threshold: .35 });
    revealNodes.forEach(node => observer.observe(node));
  }
}

function selectPolicyStep(button) {
  const step = Number(button.dataset.policyStep);
  $$('.policy-stepper button').forEach(item => {
    const itemStep = Number(item.dataset.policyStep);
    item.classList.toggle('active', item === button);
    item.classList.toggle('complete', itemStep < step);
  });
}

function invokeCanonicalScenario(name) {
  if (name === 'risk') return $('#injectRisk')?.click();
  const trigger = $(`[data-story-scenario="${name}"]`) || $(`[data-scenario="${name}"]`);
  trigger?.click();
}

function initAuthorityBuilder() {
  $$('.policy-stepper button').forEach(button => button.addEventListener('click', () => selectPolicyStep(button)));
  $$('.option-wheel button').forEach(button => button.addEventListener('click', () => {
    $$('.option-wheel button').forEach(item => item.setAttribute('aria-selected', String(item === button)));
    button.scrollIntoView({ block: 'center', behavior: reduceMotion() ? 'auto' : 'smooth' });
    invokeCanonicalScenario(button.dataset.optionScenario);
  }));
}

function clearAttackSuite() {
  runtime.suiteTimers.forEach(timer => window.clearTimeout(timer));
  runtime.suiteTimers = [];
}

function runAttackSuite() {
  clearAttackSuite();
  const button = $('#runAttackSuite');
  const sequence = ['safe', 'overspend', 'unknown', 'wrong', 'evasion', 'rapid', 'pending'];
  if (button) { button.disabled = true; button.textContent = 'ATTACK SUITE RUNNING'; }
  sequence.forEach((name, index) => {
    runtime.suiteTimers.push(window.setTimeout(() => invokeCanonicalScenario(name), reduceMotion() ? index * 5 : index * 460));
  });
  runtime.suiteTimers.push(window.setTimeout(() => {
    if (button) { button.disabled = false; button.textContent = 'OWNER ACTION AVAILABLE'; }
    $('#storyKillSwitch')?.focus({ preventScroll: true });
  }, reduceMotion() ? sequence.length * 5 + 10 : sequence.length * 460 + 80));
}

function initAttackTheatre() {
  $('#runAttackSuite')?.addEventListener('click', runAttackSuite);
  $('#storyKillSwitch')?.addEventListener('click', () => {
    clearAttackSuite();
    const badge = $('#judgeStateBadge');
    if (badge && !reduceMotion()) {
      badge.classList.remove('letter-glitch-event');
      void badge.offsetWidth;
      badge.classList.add('letter-glitch-event');
    }
  });
}

function activateDockView(view) {
  $(`.nav-item[data-view="${view}"]`)?.click();
  $$('.mobile-dock button').forEach(button => button.classList.toggle('active', button.dataset.dockView === view));
}

function initDocks() {
  $$('.mobile-dock [data-dock-view]').forEach(button => button.addEventListener('click', () => activateDockView(button.dataset.dockView)));
  $$('.nav-item[data-view]').forEach(button => button.addEventListener('click', () => {
    $$('.mobile-dock button').forEach(item => item.classList.toggle('active', item.dataset.dockView === button.dataset.view));
  }));
  $$('[data-dock-action]').forEach(button => button.addEventListener('click', () => {
    const action = button.dataset.dockAction;
    if (action === 'reset') $('#resetEnvironment')?.click();
    if (action === 'judge') $('#launchJudgeMode')?.click();
    if (action === 'forensics') activateDockView('forensics');
    if (action === 'contract') $('#contract-enforcement')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth' });
    if (action === 'freeze') $('.kill-switch')?.click();
  }));
}

function initProofTyping() {
  const terminal = $('#proofTerminal');
  if (!terminal) return;
  const line = document.createElement('div');
  line.className = 'typing-proof-line';
  line.setAttribute('aria-hidden', 'true');
  terminal.insertAdjacentElement('afterend', line);
  const reveal = () => {
    window.clearInterval(runtime.typingTimer);
    const text = terminal.dataset.eventId ? 'evidence.chain → intent → rule → result → recorded' : 'awaiting canonical ledger evidence';
    if (reduceMotion()) { line.textContent = text; return; }
    line.textContent = '';
    let index = 0;
    runtime.typingTimer = window.setInterval(() => {
      line.textContent = text.slice(0, ++index);
      if (index >= text.length) window.clearInterval(runtime.typingTimer);
    }, 13);
  };
  new MutationObserver(reveal).observe(terminal, { attributes: true, attributeFilter: ['data-event-id'] });
  reveal();
}

function initMetricTransitions() {
  const nodes = $$('[data-browser-tests], [data-contract-field="tests"], #budgetRemaining, #protectedValue, #riskValue, #pendingOverview, #judgeAmount');
  const pulse = node => {
    node.classList.remove('number-changed');
    void node.offsetWidth;
    if (!reduceMotion()) node.classList.add('number-changed');
  };
  nodes.forEach(node => new MutationObserver(() => pulse(node)).observe(node, { childList: true, subtree: true, characterData: true }));
}

function initRuleVelocity() {
  const strip = $('.rule-velocity');
  if (!strip || reduceMotion()) return;
  const update = () => {
    runtime.scrollFrame = null;
    const rect = strip.getBoundingClientRect();
    const progress = Math.max(0, Math.min(1, (window.innerHeight - rect.top) / (window.innerHeight + rect.height)));
    strip.style.setProperty('--rule-offset', `${-2 - progress * 12}%`);
  };
  window.addEventListener('scroll', () => {
    if (!runtime.scrollFrame) runtime.scrollFrame = window.requestAnimationFrame(update);
  }, { passive: true });
  update();
}

function initLifecycle() {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAttackSuite();
  });
  window.addEventListener('pagehide', () => {
    clearAttackSuite();
    window.clearInterval(runtime.wordTimer);
    window.clearInterval(runtime.typingTimer);
  }, { once: true });
}

function initBlackLabel() {
  initTheme();
  initSectionActivity();
  initWordRotate();
  initSpecularPointer();
  initThreatZone();
  initAuthorityBuilder();
  initAttackTheatre();
  initDocks();
  initProofTyping();
  initMetricTransitions();
  initRuleVelocity();
  initLifecycle();
  window.__AEGIS_BLACK_LABEL__ = Object.freeze({
    theme: () => document.documentElement.dataset.theme,
    components: () => $$('[data-aegis-component]').map(node => node.dataset.aegisComponent),
    activeZones: () => [...runtime.visibleZones].map(node => node.id || node.dataset.zone || 'hero'),
    renderingContexts: () => $$('.magic-rings-mount canvas').length,
    reducedMotion: reduceMotion,
  });
}

document.addEventListener('DOMContentLoaded', initBlackLabel);
