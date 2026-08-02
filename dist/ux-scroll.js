const gsap = window.gsap;
const ScrollTrigger = window.ScrollTrigger;

const SELECTORS = Object.freeze({
  judge: '#judgeModal',
  redTeam: '#redTeamModal',
});

const state = {
  initialized: false,
  paused: false,
  storedScrollY: 0,
  currentChapter: 'thesis',
  context: null,
  media: null,
  modalObserver: null,
  terminalObserver: null,
  abort: null,
  pausedTriggers: [],
  generated: [],
  proofOrder: null,
  forensic: null,
  modalTween: null,
  resizeTimer: 0,
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobileLayout = () => window.matchMedia('(max-width: 767px)').matches;
const stripIndex = value => String(value ?? '').replace(/^\s*\d+\s*\/\s*/, '').trim();

function chapterDefinitions() {
  return [
    { id: 'thesis', target: '#thesis', label: $('.brand > span:last-child')?.textContent.trim() || 'AEGIS' },
    { id: 'threat', target: '#threat', label: stripIndex($('#threat .zone-index')?.textContent) },
    { id: 'authority', target: '#authority', label: stripIndex($('#authority .chapter-heading > span')?.textContent) },
    { id: 'intervention', target: '#intervention', label: stripIndex($('#intervention .chapter-heading > span')?.textContent) },
    { id: 'control', target: '#control-centre', label: stripIndex($('#control-centre .chapter-heading > span')?.textContent) },
    { id: 'challenge', target: null, label: $('#redTeamTitle')?.textContent.trim() || 'RED TEAM LAB', action: 'red-team' },
    { id: 'proof', target: '#proof', label: stripIndex($('#proof .chapter-heading > span')?.textContent) },
    { id: 'system', target: '#policy-network', label: stripIndex($('#policy-network .zone-index')?.textContent) },
  ];
}

function markUxStructure() {
  const definitions = chapterDefinitions();
  definitions.forEach(definition => {
    const target = definition.target ? $(definition.target) : null;
    if (target) target.dataset.uxChapter = definition.id;
  });
  const proof = $('#proof');
  const featureProof = $('.feature-proof');
  if (proof && featureProof && proof.nextElementSibling?.id === 'control-centre') {
    state.proofOrder = { proof, previousNext: proof.nextElementSibling };
    featureProof.before(proof);
  }
  $$('.chapter-heading h2,.network-heading h2,#threatTitle').forEach(element => { element.dataset.uxMask = ''; });
  $$('.chapter-heading p,.network-heading p,.threat-copy>p,.contract-enforcement-intro').forEach(element => { element.dataset.uxReveal = ''; });
  $$('.proof-mode,.feature-proof article,.metric-card,.contract-enforcement .enforcement-layer').forEach(element => { element.dataset.uxStagger = ''; });
  $$('.threat-scan,.authority-instrument,#controlShell,.proof-instrument,.contract-enforcement,.network-stage').forEach(element => { element.dataset.uxScale = ''; });
  $$('.legal,#proofTerminal,#redTeamTerminal,.judge-result').forEach(element => { element.dataset.uxStatic = ''; });
}

function createChapterRail() {
  const definitions = chapterDefinitions();
  const rail = document.createElement('nav');
  rail.className = 'ux-chapter-rail';
  rail.setAttribute('aria-label', 'Chapter navigation');
  const current = document.createElement('div');
  current.className = 'ux-current-chapter';
  const currentIndex = document.createElement('span');
  currentIndex.textContent = '01';
  const currentLabel = document.createElement('b');
  currentLabel.textContent = definitions[0].label;
  current.append(currentIndex, currentLabel);
  const buttons = document.createElement('div');
  buttons.className = 'ux-chapter-buttons';
  definitions.forEach((definition, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.uxChapterTarget = definition.id;
    button.textContent = String(index + 1).padStart(2, '0');
    button.setAttribute('aria-label', `Go to ${definition.label}`);
    button.addEventListener('click', () => controller.scrollToChapter(definition.id), { signal: state.abort.signal });
    buttons.append(button);
  });
  const shortcuts = document.createElement('div');
  shortcuts.className = 'ux-chapter-shortcuts';
  const judge = document.createElement('button');
  judge.type = 'button';
  judge.textContent = $('.quick-dock [data-dock-action="judge"] span')?.textContent.trim() || '◇';
  judge.setAttribute('aria-label', 'Open Judge Mode');
  judge.addEventListener('click', () => $('#launchJudgeMode')?.click(), { signal: state.abort.signal });
  const redTeam = document.createElement('button');
  redTeam.type = 'button';
  redTeam.textContent = $('.quick-dock [data-open-red-team] span')?.textContent.trim() || '⚑';
  redTeam.setAttribute('aria-label', 'Open Red Team Lab');
  redTeam.addEventListener('click', () => $('[data-open-red-team]')?.click(), { signal: state.abort.signal });
  shortcuts.append(judge, redTeam);
  const progress = document.createElement('i');
  progress.className = 'ux-reading-progress';
  progress.setAttribute('aria-hidden', 'true');
  rail.append(current, buttons, shortcuts, progress);
  document.body.append(rail);
  state.generated.push(rail);
  return { rail, currentIndex, currentLabel, progress, definitions };
}

function setCurrentChapter(id, railState) {
  const index = railState.definitions.findIndex(definition => definition.id === id);
  if (index < 0) return;
  state.currentChapter = id;
  document.body.dataset.uxCurrentChapter = id;
  railState.currentIndex.textContent = String(index + 1).padStart(2, '0');
  railState.currentLabel.textContent = railState.definitions[index].label;
  $$('[data-ux-chapter-target]', railState.rail).forEach(button => {
    const active = button.dataset.uxChapterTarget === id;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  });
  $$('.header-nav a').forEach(link => {
    const matches = link.getAttribute('href') === railState.definitions[index].target;
    link.classList.toggle('ux-current', matches);
    if (matches) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}

function setupNavigation(railState) {
  const header = $('.site-header');
  let keyboardVisible = false;
  document.addEventListener('focusin', event => {
    keyboardVisible = event.target.matches('a,button,input,select,textarea,summary,[tabindex]');
    if (keyboardVisible) header?.classList.remove('ux-header-hidden');
  }, { signal: state.abort.signal });
  document.addEventListener('pointerdown', () => { keyboardVisible = false; }, { signal: state.abort.signal });
  ScrollTrigger.create({
    id: 'ux-header-direction', start: 0, end: () => ScrollTrigger.maxScroll(window),
    onUpdate(self) {
      const shouldHide = self.scroll() > 110 && self.direction > 0 && Math.abs(self.getVelocity()) > 260 && !keyboardVisible && !state.paused;
      header?.classList.toggle('ux-header-hidden', shouldHide);
      if (self.scroll() < 70 || self.direction < 0) header?.classList.remove('ux-header-hidden');
    },
    invalidateOnRefresh: true,
  });
  ScrollTrigger.create({
    id: 'ux-reading-progress', start: 0, end: () => ScrollTrigger.maxScroll(window),
    onUpdate(self) { railState.progress.style.setProperty('--ux-progress', String(self.progress)); },
    invalidateOnRefresh: true,
  });
  railState.definitions.filter(definition => definition.target).forEach(definition => {
    ScrollTrigger.create({
      id: `ux-chapter-${definition.id}`, trigger: definition.target, start: 'top 48%', end: 'bottom 48%',
      onEnter: () => setCurrentChapter(definition.id, railState),
      onEnterBack: () => setCurrentChapter(definition.id, railState),
      invalidateOnRefresh: true,
    });
  });
  setCurrentChapter('thesis', railState);
}

function setupSectionEntries() {
  ScrollTrigger.batch('[data-ux-reveal]', {
    start: 'top 88%', once: true, interval: 0.08, batchMax: 4,
    onEnter(batch) {
      gsap.fromTo(batch, { autoAlpha: 0, y: 18 }, {
        autoAlpha: 1, y: 0, duration: 0.56, stagger: 0.06, ease: 'power2.out', clearProps: 'opacity,visibility,transform,willChange',
      });
    },
  });
  ScrollTrigger.batch('[data-ux-stagger]', {
    start: 'top 90%', once: true, interval: 0.06, batchMax: 6,
    onEnter(batch) {
      gsap.fromTo(batch, { autoAlpha: 0, y: 14 }, {
        autoAlpha: 1, y: 0, duration: 0.48, stagger: 0.05, ease: 'power2.out', clearProps: 'opacity,visibility,transform,willChange',
      });
    },
  });
  $$('[data-ux-mask]').forEach(element => {
    gsap.fromTo(element, { clipPath: 'inset(0 100% 0 0)' }, {
      clipPath: 'inset(0 0% 0 0)', duration: 0.62, ease: 'power3.out', clearProps: 'clipPath,willChange',
      scrollTrigger: { trigger: element, start: 'top 86%', once: true, fastScrollEnd: true },
    });
  });
  ScrollTrigger.batch('[data-ux-scale]:not(#controlShell)', {
    start: 'top 90%', once: true, interval: 0.08, batchMax: 3,
    onEnter(batch) {
      gsap.fromTo(batch, { autoAlpha: 0.82, scale: 0.975 }, {
        autoAlpha: 1, scale: 1, duration: 0.62, stagger: 0.07, ease: 'power2.out', clearProps: 'opacity,visibility,transform,willChange',
      });
    },
  });
}

function setupHeroDeparture() {
  const timeline = gsap.timeline({
    defaults: { ease: 'none' },
    scrollTrigger: {
      id: 'ux-hero-departure', trigger: '#thesis', start: 'top top', end: 'bottom top', scrub: 0.35,
      preventOverlaps: 'ux-chapters', fastScrollEnd: true, invalidateOnRefresh: true,
    },
  });
  timeline.to('#thesis .hero-copy h1', { y: -24 }, 0)
    .to('#thesis .hero-sub', { y: -10, opacity: 0.72 }, 0)
    .to('#thesis .hero-actions', { opacity: 0.86 }, 0.08)
    .to('#thesis .hero-system', { scale: 0.96, transformOrigin: '50% 55%' }, 0)
    .to('#thesis .ambient,#thesis .proof-sparkles', { opacity: 0.25 }, 0);
}

function setupRuleVelocity() {
  const row = $('.rule-velocity div');
  if (!row) return;
  ScrollTrigger.create({
    id: 'ux-rule-velocity', trigger: '.rule-velocity', start: 'top bottom', end: 'bottom top',
    onUpdate(self) {
      const offset = Math.max(-8, Math.min(3, -2 - self.getVelocity() / 1600));
      gsap.to(row, { xPercent: offset, duration: 0.32, overwrite: true, ease: 'power2.out' });
    },
  });
}

function setAuthorityStep(authority, index) {
  authority.dataset.uxAuthorityStep = String(index + 1);
  $$('[data-policy-step]', authority).forEach((button, buttonIndex) => button.classList.toggle('ux-scroll-active', buttonIndex === index));
}

function setupAuthorityStory() {
  const authority = $('#authority');
  const steps = $$('[data-policy-step]', authority);
  if (!authority || !steps.length) return;
  authority.classList.add('ux-authority-story');
  steps.forEach((step, index) => {
    ScrollTrigger.create({
      id: `ux-authority-step-${index + 1}`, trigger: step, start: 'top 58%', end: 'bottom 42%',
      onEnter: () => setAuthorityStep(authority, index), onEnterBack: () => setAuthorityStep(authority, index),
      invalidateOnRefresh: true,
    });
  });
  setAuthorityStep(authority, 0);
}

function setInterventionStage(stage, progress, progressNode) {
  if ($('#intervention')?.dataset.uxLive === 'true') return;
  const index = Math.max(0, Math.min(7, Math.floor(progress * 8)));
  stage.dataset.uxStage = String(index);
  $$('.story-scenario', stage).forEach((button, buttonIndex) => button.classList.toggle('ux-scroll-active', buttonIndex === index));
  $$('i', progressNode).forEach((dot, dotIndex) => dot.classList.toggle('active', dotIndex <= index));
}

function setupInterventionTheatre() {
  const intervention = $('#intervention');
  const stage = $('#storyFlow');
  const toolbar = $('.attack-theatre-toolbar');
  if (!intervention || !stage || !toolbar) return;
  const progress = document.createElement('div');
  progress.className = 'ux-intervention-progress';
  progress.setAttribute('aria-hidden', 'true');
  for (let index = 0; index < 8; index += 1) progress.append(document.createElement('i'));
  toolbar.after(progress);
  state.generated.push(progress);
  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'ux-story-skip';
  skip.textContent = '→';
  skip.setAttribute('aria-label', 'Skip intervention explanation');
  skip.addEventListener('click', () => controller.scrollToChapter('control'), { signal: state.abort.signal });
  toolbar.append(skip);
  state.generated.push(skip);
  intervention.addEventListener('click', event => {
    if (event.target.closest('.story-scenario,#runAttackSuite,#storyKillSwitch')) intervention.dataset.uxLive = 'true';
  }, { signal: state.abort.signal, capture: true });
  ScrollTrigger.create({
    id: 'ux-intervention-theatre', trigger: stage, start: 'top 84px',
    end: () => `+=${Math.round(window.innerHeight * 2.8)}`, pin: true, pinSpacing: true, scrub: 0.28,
    anticipatePin: 1, preventOverlaps: 'ux-chapters', fastScrollEnd: true, invalidateOnRefresh: true,
    onUpdate: self => setInterventionStage(stage, self.progress, progress),
    onToggle: self => intervention.classList.toggle('ux-theatre-active', self.isActive),
    onLeave: () => { if (intervention.dataset.uxLive !== 'true') stage.removeAttribute('data-ux-stage'); },
    onLeaveBack: () => { if (intervention.dataset.uxLive !== 'true') stage.removeAttribute('data-ux-stage'); },
  });
}

function setupControlReveal({ mobile = false } = {}) {
  const shell = $('#controlShell');
  if (!shell) return;
  gsap.fromTo(shell, {
    scale: mobile ? 0.97 : 0.95,
    rotateX: mobile ? 0 : 4,
    transformPerspective: mobile ? 0 : 1400,
    transformOrigin: '50% 0%',
  }, {
    scale: 1, rotateX: 0, duration: 0.68, ease: 'power3.out', clearProps: 'transform,transformOrigin,transformPerspective,willChange',
    onStart: () => shell.classList.add('ux-control-entering'),
    onComplete: () => shell.classList.remove('ux-control-entering'),
    scrollTrigger: { id: 'ux-control-reveal', trigger: shell, start: 'top 82%', once: true, fastScrollEnd: true, invalidateOnRefresh: true },
  });
}

function setupProofPath() {
  const proof = $('#proof');
  const contract = $('#contract-enforcement');
  if (!proof || !contract) return;
  const path = document.createElement('div');
  path.className = 'ux-proof-path';
  path.setAttribute('aria-hidden', 'true');
  const line = document.createElement('i');
  path.append(line);
  proof.append(path);
  state.generated.push(path);
  ScrollTrigger.create({
    id: 'ux-proof-tracing-beam', trigger: proof, endTrigger: contract, start: 'top 72%', end: 'bottom 72%', scrub: 0.3,
    onUpdate: self => line.style.setProperty('--ux-proof-progress', String(self.progress)),
    invalidateOnRefresh: true,
  });
  const stages = [...$$('.proof-mode', proof), contract];
  stages.forEach((stage, index) => ScrollTrigger.create({
    id: `ux-proof-stage-${index + 1}`, trigger: stage, start: 'top 66%', end: 'bottom 34%',
    onToggle: self => stage.classList.toggle('ux-proof-active', self.isActive), invalidateOnRefresh: true,
  }));
  const comparison = $('.proof-comparison', proof);
  if (comparison) {
    gsap.timeline({ scrollTrigger: { id: 'ux-twin-comparison', trigger: comparison, start: 'top 82%', end: 'bottom 36%', scrub: 0.28, invalidateOnRefresh: true } })
      .fromTo($('b:first-child', comparison), { x: 0 }, { x: 7, ease: 'none' }, 0)
      .fromTo($('b:last-child', comparison), { x: 0 }, { x: -7, ease: 'none' }, 0);
  }
}

function parseTerminalEvidence() {
  const terminal = $('#proofTerminal');
  const compact = $('.ux-forensic-compact');
  if (!terminal || !compact) return;
  const wanted = new Set(['INTENT', 'POLICY', 'RULE', 'OWNER ACTION', 'FINAL STATUS', 'FUNDS MOVED']);
  const rows = terminal.textContent.split('\n').map(line => {
    const match = line.match(/^([A-Z ]+?)\s{2,}(.+)$/);
    return match ? [match[1].trim(), match[2].trim()] : null;
  }).filter(row => row && wanted.has(row[0]));
  compact.replaceChildren(...rows.map(([label, value]) => {
    const row = document.createElement('div');
    const key = document.createElement('small');
    const evidence = document.createElement('b');
    key.textContent = label;
    evidence.textContent = value;
    row.append(key, evidence);
    return row;
  }));
}

function setupForensicDisclosure() {
  const layout = $('.forensic-layout');
  const terminalLabel = $('.terminal-bar b', layout);
  if (!layout || !terminalLabel || layout.parentElement?.classList.contains('ux-forensic-disclosure')) return;
  const compact = document.createElement('div');
  compact.className = 'ux-forensic-compact';
  layout.before(compact);
  const details = document.createElement('details');
  details.className = 'ux-forensic-disclosure';
  const summary = document.createElement('summary');
  summary.append(terminalLabel);
  const icon = document.createElement('span');
  icon.textContent = '+';
  icon.setAttribute('aria-hidden', 'true');
  summary.append(icon);
  layout.before(details);
  details.append(summary, layout);
  details.addEventListener('toggle', () => requestAnimationFrame(() => controller.refresh()), { signal: state.abort.signal });
  state.forensic = { details, layout, compact, terminalLabel };
  parseTerminalEvidence();
  state.terminalObserver = new MutationObserver(parseTerminalEvidence);
  state.terminalObserver.observe($('#proofTerminal'), { childList: true, characterData: true, subtree: true });
}

function setupDisclosureRefresh() {
  $$('details').forEach(details => details.addEventListener('toggle', () => {
    window.clearTimeout(state.resizeTimer);
    state.resizeTimer = window.setTimeout(() => controller.refresh(), 300);
  }, { signal: state.abort.signal }));
}

function anyModalOpen() {
  return Object.values(SELECTORS).some(selector => !$(selector)?.classList.contains('hidden'));
}

function animateRedTeamEntrance() {
  if (reducedMotion()) return;
  const shell = $('#redTeamShell');
  shell?.classList.add('ux-lab-entering');
  state.modalTween?.kill();
  state.modalTween = gsap.timeline({ defaults: { duration: 0.38, ease: 'power2.out' }, onComplete: () => shell?.classList.remove('ux-lab-entering') })
    .fromTo('#redTeamPresets', { autoAlpha: 0, x: -12 }, { autoAlpha: 1, x: 0, clearProps: 'opacity,visibility,transform' }, 0)
    .fromTo('#redTeamForm', { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, clearProps: 'opacity,visibility,transform' }, 0.06)
    .fromTo('.red-team-stage', { autoAlpha: 0.85, scale: 0.985 }, { autoAlpha: 1, scale: 1, clearProps: 'opacity,visibility,transform' }, 0.08);
}

function setupModalSafety(railState) {
  const watched = Object.values(SELECTORS).map(selector => $(selector)).filter(Boolean);
  document.addEventListener('click', event => {
    if (event.target.closest('[data-open-red-team],#launchJudgeMode,#launchJudgeModeBottom,[data-dock-action="judge"]')) {
      controller.pause();
      window.setTimeout(() => { if (!anyModalOpen()) controller.resume(); }, 500);
    }
  }, { signal: state.abort.signal, capture: true });
  state.modalObserver = new MutationObserver(records => {
    const redOpened = records.some(record => record.target.matches(SELECTORS.redTeam) && !record.target.classList.contains('hidden'));
    if (anyModalOpen()) {
      controller.pause();
      if (redOpened) { setCurrentChapter('challenge', railState); animateRedTeamEntrance(); }
    } else if (state.paused) controller.resume();
  });
  watched.forEach(modal => state.modalObserver.observe(modal, { attributes: true, attributeFilter: ['class'] }));
}

function setupDesktopAnimations() {
  setupSectionEntries();
  setupHeroDeparture();
  setupRuleVelocity();
  setupAuthorityStory();
  setupInterventionTheatre();
  setupControlReveal({ mobile: false });
  setupProofPath();
}

function setupMobileAnimations() {
  setupSectionEntries();
  $('#authority')?.classList.remove('ux-authority-story');
  $$('#storyFlow,[data-ux-scale]').forEach(element => { element.style.transform = ''; });
  setupControlReveal({ mobile: true });
}

function staticFinalState() {
  document.documentElement.classList.add('ux-reduced-motion');
  $$('[data-ux-reveal],[data-ux-stagger],[data-ux-mask],[data-ux-scale]').forEach(element => {
    gsap.set(element, { clearProps: 'all' });
  });
}

function cleanupForensicDisclosure() {
  if (!state.forensic) return;
  const { details, layout, compact, terminalLabel } = state.forensic;
  $('.terminal-bar', layout)?.append(terminalLabel);
  details.before(layout);
  details.remove();
  compact.remove();
  state.forensic = null;
}

const controller = Object.freeze({
  init() {
    if (state.initialized) controller.destroy();
    if (!gsap || !ScrollTrigger) throw new Error('Aegis UX orchestration requires the single local GSAP ScrollTrigger runtime.');
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ limitCallbacks: true, ignoreMobileResize: true });
    state.abort = new AbortController();
    markUxStructure();
    const railState = createChapterRail();
    setupForensicDisclosure();
    setupDisclosureRefresh();
    state.context = gsap.context(() => {
      setupNavigation(railState);
      state.media = gsap.matchMedia();
      state.media.add({
        desktop: '(min-width: 768px) and (prefers-reduced-motion: no-preference)',
        mobile: '(max-width: 767px) and (prefers-reduced-motion: no-preference)',
        reduce: '(prefers-reduced-motion: reduce)',
      }, context => {
        if (context.conditions.reduce) staticFinalState();
        else if (context.conditions.desktop) setupDesktopAnimations();
        else setupMobileAnimations();
      });
    }, document.body);
    setupModalSafety(railState);
    const refresh = () => {
      window.clearTimeout(state.resizeTimer);
      state.resizeTimer = window.setTimeout(() => controller.refresh(), 140);
    };
    window.addEventListener('resize', refresh, { signal: state.abort.signal, passive: true });
    window.addEventListener('orientationchange', refresh, { signal: state.abort.signal, passive: true });
    window.addEventListener('pageshow', refresh, { signal: state.abort.signal, passive: true });
    document.documentElement.classList.add('ux-scroll-enhanced');
    document.body.dataset.uxScrollState = 'active';
    state.initialized = true;
    requestAnimationFrame(() => ScrollTrigger.refresh(true));
    return controller;
  },
  refresh() {
    if (!state.initialized || state.paused) return;
    ScrollTrigger.refresh(true);
  },
  pause() {
    if (!state.initialized || state.paused) return;
    state.paused = true;
    state.storedScrollY = window.scrollY;
    state.pausedTriggers = ScrollTrigger.getAll().filter(trigger => trigger.enabled);
    state.pausedTriggers.forEach(trigger => trigger.disable(false, true));
    window.scrollTo(0, state.storedScrollY);
    document.body.dataset.uxScrollState = 'paused';
  },
  resume() {
    if (!state.initialized || !state.paused || anyModalOpen()) return;
    const restoreY = state.storedScrollY;
    state.pausedTriggers.forEach(trigger => trigger.enable(false, true));
    state.pausedTriggers = [];
    state.paused = false;
    document.body.dataset.uxScrollState = 'active';
    ScrollTrigger.refresh();
    window.scrollTo(0, restoreY);
    requestAnimationFrame(() => {
      window.scrollTo(0, restoreY);
      ScrollTrigger.update();
      requestAnimationFrame(() => window.scrollTo(0, restoreY));
    });
  },
  destroy() {
    if (!state.initialized) return;
    state.modalTween?.kill();
    state.modalObserver?.disconnect();
    state.terminalObserver?.disconnect();
    state.abort?.abort();
    state.media?.revert();
    state.context?.revert();
    ScrollTrigger.getAll().forEach(trigger => trigger.kill(true));
    cleanupForensicDisclosure();
    state.generated.forEach(element => element.remove());
    state.generated = [];
    document.documentElement.classList.remove('ux-scroll-enhanced', 'ux-reduced-motion');
    document.body.removeAttribute('data-ux-scroll-state');
    document.body.removeAttribute('data-ux-current-chapter');
    $('.site-header')?.classList.remove('ux-header-hidden');
    window.clearTimeout(state.resizeTimer);
    Object.assign(state, { initialized: false, paused: false, currentChapter: 'thesis', context: null, media: null, modalObserver: null, terminalObserver: null, abort: null, pausedTriggers: [], modalTween: null });
  },
  scrollToChapter(id) {
    const definition = chapterDefinitions().find(chapter => chapter.id === id);
    if (!definition) return false;
    if (definition.action === 'red-team') {
      $('[data-open-red-team]')?.click();
      return true;
    }
    const target = $(definition.target);
    target?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
    return Boolean(target);
  },
  diagnostics() {
    return {
      initialized: state.initialized,
      paused: state.paused,
      currentChapter: state.currentChapter,
      triggerCount: ScrollTrigger?.getAll().length ?? 0,
      pinnedTriggers: ScrollTrigger?.getAll().filter(trigger => Boolean(trigger.pin)).length ?? 0,
      scrubbedTriggers: ScrollTrigger?.getAll().filter(trigger => Boolean(trigger.vars?.scrub)).length ?? 0,
      reducedMotion: reducedMotion(),
      mobile: mobileLayout(),
      storedScrollY: state.storedScrollY,
    };
  },
});

window.UxScrollController = controller;
document.addEventListener('DOMContentLoaded', () => requestAnimationFrame(() => controller.init()), { once: true });

export { controller as UxScrollController };
