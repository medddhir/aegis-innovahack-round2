import {
  AegisPolicyEngine,
  DEFAULT_POLICY,
  RULES,
  runPolicyDigitalTwin,
} from './policy-engine.js';
import {
  JUDGE_MODE_STATES,
  JudgeModeStateMachine,
  deriveDecisionPipeline,
  extractLedgerEvidence,
  extractRuleTrace,
} from './judge-mode.js';
import {
  createCoreVisualState,
  createEvasionClusterModel,
  createIncidentStages,
  createTwinReplayModel,
  visualStateForRisk,
} from './visual-state.js';

const JUDGE_SCENARIOS = [
  {
    number: '01', feature: 'NORMAL OPERATION', title: 'Authorised payment',
    description: 'The agent requests ₹1,200 to an approved cloud provider. Aegis verifies the task, recipient, amount and active policy before approval.',
    amount: '₹1,200 → CloudGrid', action: 'safe',
  },
  {
    number: '02', feature: 'INDEPENDENT ENFORCEMENT', title: 'Overspending attempt',
    description: 'The agent requests ₹8,500 even though its per-transaction cap is ₹2,500. The policy lives outside the agent, so the request cannot bypass it.',
    amount: '₹8,500 → CloudGrid', action: 'overspend',
  },
  {
    number: '03', feature: 'EVASION SHIELD', title: 'Threshold splitting attack',
    description: 'The compromised agent divides one large payment into four requests of ₹1,999. Aegis groups them as one coordinated sequence instead of approving them independently.',
    amount: '4 × ₹1,999 → CloudGrid', action: 'evasion',
  },
  {
    number: '04', feature: 'ADAPTIVE RISK GOVERNOR', title: 'Permissions tighten automatically',
    description: 'Repeated violations raise the deterministic behavioural risk score. At the Restricted threshold, future valid requests require owner approval.',
    amount: 'CALCULATED RISK TRANSITION', action: 'risk',
  },
  {
    number: '05', feature: 'IN-FLIGHT REVOCATION', title: 'Freeze before settlement',
    description: 'A valid or owner-approved transaction enters a settlement queue. The owner freezes the agent before final revalidation, invalidating the pending intent before funds move.',
    amount: '₹1,500 → ComputeHub', action: 'freezePending',
  },
  {
    number: '06', feature: 'FORENSIC PROOF LEDGER', title: 'Replay the recorded evidence',
    description: 'Aegis reads the actual ledger entries produced by the preceding engine decisions, including rules, risk signals, owner action and final funds moved.',
    amount: 'RECORDED POLICY EVIDENCE', action: 'forensics',
  },
];

const state = {
  engine: null,
  logicalTime: 0,
  intentSequence: 0,
  countdownId: null,
  pendingSeconds: 0,
  pendingIntentId: null,
  replayIndex: 0,
  replayTimer: null,
  eventCursor: 0,
  twinResults: null,
  twinTimers: [],
  judgeEvidence: new Map(),
  judgeView: null,
  judgePreviousFocus: null,
  renderedEventIds: new Set(),
  animationFrames: new Map(),
};

const judgeMachine = new JudgeModeStateMachine({ scenarioCount: JUDGE_SCENARIOS.length });

const DEMO_START = new Date('2026-08-01T09:42:31.000Z').getTime();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const formatINR = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const displayTime = value => new Date(value).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
const displayDecision = decision => ({ APPROVE: 'APPROVED', HOLD: 'HOLD', REQUIRE_APPROVAL: 'REQUIRE APPROVAL', BLOCK: 'BLOCKED', INVALIDATE: 'INVALIDATED', FREEZE: 'FROZEN' }[decision] ?? decision);
const decisionClass = decision => decision === 'APPROVE' ? 'approved' : decision === 'HOLD' || decision === 'REQUIRE_APPROVAL' ? 'pending' : 'blocked';
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function cancelMetricAnimations() {
  for (const frame of state.animationFrames.values()) cancelAnimationFrame(frame);
  state.animationFrames.clear();
}

function animateMetric(element, nextValue, formatter = value => String(Math.round(value))) {
  const previousValue = Number(element.dataset.metricValue);
  const target = Number(nextValue);
  const existingFrame = state.animationFrames.get(element);
  if (existingFrame) cancelAnimationFrame(existingFrame);
  element.dataset.metricValue = String(target);
  if (!Number.isFinite(previousValue) || previousValue === target || reducedMotion()) {
    element.textContent = formatter(target);
    return;
  }
  const startedAt = performance.now();
  const duration = 360;
  const step = now => {
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = formatter(previousValue + (target - previousValue) * eased);
    if (progress < 1) {
      state.animationFrames.set(element, requestAnimationFrame(step));
    } else {
      state.animationFrames.delete(element);
      element.textContent = formatter(target);
    }
  };
  state.animationFrames.set(element, requestAnimationFrame(step));
}

function pulseOnce(element, className) {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
}

function nextTimestamp(stepMs = 1_000) {
  const timestamp = new Date(state.logicalTime).toISOString();
  state.logicalTime += stepMs;
  return timestamp;
}

function createEngine() {
  state.logicalTime = DEMO_START;
  state.intentSequence = 0;
  state.engine = new AegisPolicyEngine({
    policy: DEFAULT_POLICY,
    clock: () => nextTimestamp(),
  });
}

function makeIntent(tag, overrides = {}, stepMs = 1_000) {
  state.intentSequence += 1;
  const requestedAt = overrides.requestedAt ?? nextTimestamp(stepMs);
  const suffix = String(state.intentSequence).padStart(3, '0');
  return {
    id: `AGS-${tag}-${suffix}`,
    agentId: state.engine.policy.authorisedAgentId,
    taskId: state.engine.policy.taskId,
    amount: 1_200,
    recipient: 'CloudGrid',
    category: state.engine.policy.approvedCategory,
    requestedAt,
    expiresAt: state.engine.policy.expiresAt,
    policyVersion: state.engine.policy.version,
    nonce: `NONCE-${tag}-${suffix}`,
    status: 'REQUESTED',
    ...overrides,
  };
}

function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => element.classList.remove('show'), 2_600);
}

function ledgerPresentation(event) {
  const amount = event.intent ? `${formatINR(event.intent.amount)} → ${event.intent.recipient}` : event.policyLabel;
  if (event.eventType === 'OWNER_ACTION' && event.decision === 'FREEZE') {
    return { title: 'Owner activated kill switch', detail: event.reason, status: 'FROZEN', kind: 'frozen' };
  }
  if (event.eventType === 'POLICY_ACTIVATED') {
    return { title: 'Budget Capsule activated', detail: event.reason, status: 'ACTIVE', kind: 'system' };
  }
  if (event.eventType === 'POLICY_MODIFICATION_ATTEMPT') {
    return { title: 'Policy modification attempt blocked', detail: event.reason, status: 'BLOCKED', kind: 'blocked' };
  }
  if (event.decision === 'APPROVE') return { title: 'Transaction settled after revalidation', detail: `${amount} · ${event.reason}`, status: 'APPROVED', kind: 'approved' };
  if (event.decision === 'HOLD') return { title: event.ownerAction ? 'Owner approved pending intent' : 'Transaction intent authorised', detail: `${amount} · ${event.reason}`, status: 'PENDING', kind: 'pending' };
  if (event.decision === 'REQUIRE_APPROVAL') return { title: 'Risk Governor requires owner approval', detail: `${amount} · ${event.reason}`, status: 'PENDING', kind: 'pending' };
  if (event.decision === 'INVALIDATE') return { title: 'Pending intent invalidated', detail: `${amount} · ${event.reason}`, status: 'INVALIDATED', kind: 'blocked' };
  return { title: event.ruleChecked === RULES.EVASION_SHIELD ? 'Evasion Shield blocked coordinated intent' : 'Policy engine blocked intent', detail: `${amount} · ${event.reason}`, status: 'BLOCKED', kind: 'blocked' };
}

function renderEvents() {
  const events = state.engine.getLedger().slice(state.eventCursor).slice(-18).reverse();
  const stream = $('#eventStream');
  if (events.length === 0) {
    stream.innerHTML = '<div class="event-item"><span class="event-time">—</span><div class="event-main"><strong>Deterministic environment ready</strong><small>Run a scenario to record its policy evidence.</small></div><span class="event-status system">ACTIVE</span></div>';
    return;
  }
  stream.innerHTML = events.map(event => {
    const item = ledgerPresentation(event);
    const isNew = !state.renderedEventIds.has(event.id);
    const intentEvidence = event.intent
      ? `<span>${escapeHTML(formatINR(event.intent.amount))}</span><span>${escapeHTML(event.intent.recipient)}</span>`
      : '<span>POLICY EVENT</span>';
    return `<div class="event-item${isNew ? ' is-new' : ''}" data-event-id="${event.id}">
      <span class="event-time">${displayTime(event.timestamp)}</span>
      <div class="event-main"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small><div class="event-evidence">${intentEvidence}<span>${escapeHTML(event.ruleChecked)}</span></div></div>
      <span class="event-status ${item.kind}">${escapeHTML(item.status)}</span>
    </div>`;
  }).join('');
  events.forEach(event => state.renderedEventIds.add(event.id));
}

function renderMetrics() {
  const snapshot = state.engine.getSnapshot();
  animateMetric($('#budgetRemaining'), snapshot.budgetRemaining, formatINR);
  $('#budgetTotalDisplay').textContent = formatINR(snapshot.policy.totalTaskBudget);
  $('#budgetBar').style.width = `${Math.min(100, (snapshot.taskSpent / snapshot.policy.totalTaskBudget) * 100)}%`;
  animateMetric($('#protectedValue'), snapshot.protectedValue, formatINR);
  animateMetric($('#approvedCount'), snapshot.approvedCount);
  animateMetric($('#blockedCount'), snapshot.blockedCount);
  animateMetric($('#pendingCount'), snapshot.pendingCount);
  animateMetric($('#pendingOverview'), snapshot.pendingCount);
  $('#topBudget').textContent = formatINR(snapshot.budgetRemaining);
  $('#topPending').textContent = String(snapshot.pendingCount);
  $('#topPolicy').textContent = snapshot.policyLabel;
  $('#capsulePolicyVersion').textContent = `POLICY VERSION · ${snapshot.policyLabel}`;
  $('#capsuleVendorCount').textContent = snapshot.policy.approvedRecipients.length;
  renderRisk();
}

function renderRisk() {
  const { risk } = state.engine.getSnapshot();
  applyGlobalVisualState(risk.state);
  const className = `state-${risk.state.toLowerCase()}`;
  const priorState = $('#stateValue').dataset.riskState;
  $('#topAgentState').textContent = risk.state;
  $('#topAgentState').className = className;
  $('#riskScreenState').textContent = risk.state;
  $('#riskScreenState').className = className;
  $('#riskScreenScore').textContent = `${risk.score} / 100`;
  $('#riskScreenReason').textContent = risk.response;
  $('#stateValue').textContent = risk.state;
  $('#stateValue').className = className;
  $('#stateValue').dataset.riskState = risk.state;
  animateMetric($('#riskValue'), risk.score);
  $('#riskBar').style.width = `${risk.score}%`;
  $('#riskBar').style.background = risk.score >= 80 ? 'var(--red)' : risk.score >= 55 ? 'var(--orange)' : risk.score >= 30 ? 'var(--amber)' : 'var(--green)';
  $('#stateOrb span').style.borderColor = risk.score >= 80 ? 'rgba(255,79,102,.45)' : risk.score >= 55 ? 'rgba(255,122,69,.45)' : risk.score >= 30 ? 'rgba(255,184,77,.45)' : 'rgba(66,211,146,.28)';
  $$('.risk-step').forEach(step => step.classList.toggle('active', step.dataset.state === risk.state));
  if (priorState && priorState !== risk.state) pulseOnce($('#stateOrb'), 'state-transition');

  const velocity = risk.signals.transactionVelocity;
  const values = [
    [velocity >= 6 ? 'CRITICAL' : velocity >= 4 ? 'ELEVATED' : 'NORMAL', velocity >= 4 ? 'bad' : 'good'],
    [String(risk.signals.newRecipientAttempts), risk.signals.newRecipientAttempts ? 'bad' : 'good'],
    [String(risk.signals.retriesAfterRejection), risk.signals.retriesAfterRejection ? 'bad' : 'good'],
    [risk.signals.splitPaymentBehaviour ? 'DETECTED' : 'NOT DETECTED', risk.signals.splitPaymentBehaviour ? 'bad' : 'good'],
    [String(risk.signals.policyModificationAttempts), risk.signals.policyModificationAttempts ? 'warn' : 'good'],
  ];
  $$('#signalList > div').forEach((row, index) => {
    const value = $('b', row);
    value.textContent = values[index][0];
    value.className = values[index][1];
  });
  $('#automaticResponse p').textContent = `${risk.state} (${risk.score}/100): ${risk.response}`;
}

function renderAll({ focusLatest = true } = {}) {
  renderMetrics();
  renderEvents();
  if (focusLatest) state.replayIndex = Math.max(0, state.engine.getLedger().length - 1);
  renderForensics();
}

function showAttackResult(result, { cluster = false, clusterModel = null, reason } = {}) {
  $('#attackStatus').classList.add('hidden');
  $('#attackCluster').classList.toggle('hidden', !cluster);
  if (cluster && clusterModel) renderEvasionCluster(clusterModel);
  const panel = $('#enforcementResult');
  panel.classList.remove('hidden');
  panel.closest('.attack-visual').dataset.outcome = decisionClass(result.decision);
  $('strong', panel).textContent = displayDecision(result.decision);
  $('p', panel).textContent = reason ?? result.reason;
  $('small', panel).textContent = `Funds moved: ${formatINR(result.fundsMoved)} (simulated)`;
}

function applyGlobalVisualState(riskState) {
  const visualState = visualStateForRisk(riskState);
  document.body.dataset.riskState = visualState;
  for (const selector of ['#heroFlow', '#judgeVisual', '#controlShell', '#capsuleCard']) {
    const element = $(selector);
    if (element) element.dataset.risk = visualState;
  }
}

function applyCoreVisualState(element, result = null, flowOverride = null) {
  if (!element) return null;
  const visual = createCoreVisualState(result, state.engine?.getSnapshot().risk.state ?? 'NORMAL');
  element.dataset.flow = flowOverride ?? visual.flow;
  element.dataset.risk = visual.risk;
  element.dataset.failLayer = visual.failingLayer;
  element.dataset.walletGate = visual.walletGate;
  return visual;
}

function setHeroFlow(result = null) {
  const flow = $('#heroFlow');
  const status = $('#heroIntentStatus');
  const rule = $('#heroIntentRule');
  const amount = $('#heroIntentAmount');
  if (!result) {
    applyCoreVisualState(flow);
    status.textContent = 'READY';
    rule.textContent = 'AWAITING TRANSACTION INTENT';
    amount.textContent = '₹0 · SIMULATED';
    $('.wallet-gate-status', flow).textContent = 'OPEN · PROTECTED';
    return;
  }
  const visual = applyCoreVisualState(flow, result);
  status.textContent = displayDecision(result.decision);
  rule.textContent = result.ruleChecked;
  amount.textContent = result.intent ? `${formatINR(result.intent.amount)} → ${result.intent.recipient}` : 'Owner policy action';
  $('.wallet-gate-status', flow).textContent = visual.walletGate === 'closed'
    ? 'CLOSED · NO TRANSFER'
    : visual.flow === 'approved' ? 'OPEN · SETTLED'
      : visual.flow === 'pending' ? 'OPEN · UNSETTLED' : 'OPEN · NO TRANSFER';
}

function afterDecision(result, options = {}) {
  renderAll();
  setHeroFlow(result);
  if (options.attackResult) showAttackResult(result, options);
  toast(`${displayDecision(result.decision)} · ${result.ruleChecked}`);
  return result;
}

function runSafe({ present = true } = {}) {
  const intent = makeIntent('SAFE', { amount: 1_200, recipient: 'CloudGrid' });
  const result = state.engine.processIntent(intent);
  if (present) afterDecision(result);
  return result;
}

function runOverspend({ present = true } = {}) {
  const intent = makeIntent('OVERSPEND', { amount: 8_500, recipient: 'CloudGrid' });
  const result = state.engine.processIntent(intent);
  if (present) afterDecision(result, { attackResult: true });
  return result;
}

function runUnknown() {
  const intent = makeIntent('UNKNOWN', { amount: 2_000, recipient: '0xF4…91B' });
  return afterDecision(state.engine.processIntent(intent), { attackResult: true });
}

function runEvasion({ present = true } = {}) {
  const start = state.logicalTime;
  const offsets = [0, 3_000, 7_000, 11_000];
  const intents = offsets.map((offset, index) => makeIntent('SPLIT', {
    amount: 1_999,
    recipient: 'CloudGrid',
    requestedAt: new Date(start + offset).toISOString(),
  }));
  state.logicalTime = start + 12_000;
  const results = state.engine.processIntentBatch(intents, { incidentId: `SPLIT-${state.intentSequence}` });
  const result = results.at(-1);
  const total = intents.reduce((sum, intent) => sum + intent.amount, 0);
  const clusterModel = createEvasionClusterModel(intents, result);
  if (present) {
    afterDecision(result, {
      attackResult: true,
      cluster: true,
      clusterModel,
      reason: `${intents.length} related requests were evaluated as one ${formatINR(total)} coordinated attempt. ${result.reason}`,
    });
  }
  return result;
}

function evasionClusterMarkup(model, { compact = false } = {}) {
  const intentCards = model.intents.map((intent, index) => `<div class="cluster-intent" data-cluster-index="${index}">
    <small>INTENT ${String(index + 1).padStart(2, '0')}</small>
    <b>${escapeHTML(formatINR(intent.amount))}</b>
    <span>${escapeHTML(intent.id)}</span>
  </div>`).join('');
  return `<div class="evasion-convergence${compact ? ' compact' : ''}">
    <div class="cluster-sources">${intentCards}</div>
    <div class="cluster-relations" aria-hidden="true"><i></i><i></i><i></i><i></i><b>RELATION WINDOW</b></div>
    <div class="cluster-verdict">
      <small>COORDINATED ATTEMPT</small><strong>${escapeHTML(formatINR(model.total))}</strong>
      <span>${escapeHTML(`${model.windowSeconds}-SECOND WINDOW`)}</span>
      <code>${escapeHTML(model.decisiveRule)}</code>
      <b>${escapeHTML(displayDecision(model.decision))} · FUNDS MOVED ${escapeHTML(formatINR(model.fundsMoved))}</b>
    </div>
  </div>`;
}

function renderEvasionCluster(model) {
  $('#clusterCanvas').innerHTML = evasionClusterMarkup(model);
}

function runRapid() {
  const intents = Array.from({ length: 8 }, () => makeIntent('RAPID', {
    amount: 800,
    requestedAt: nextTimestamp(500),
  }));
  const results = state.engine.processIntentBatch(intents, { incidentId: `RAPID-${state.intentSequence}` });
  return afterDecision(results.at(-1), { attackResult: true });
}

function injectRisk({ present = true } = {}) {
  const currentRisk = state.engine.getSnapshot().risk;
  if (['RESTRICTED', 'QUARANTINED'].includes(currentRisk.state)) {
    const probe = makeIntent('RISK-PROBE', { amount: 900, recipient: 'ComputeHub' });
    const result = state.engine.processIntent(probe);
    if (present) {
      renderAll();
      toast(`Risk Governor calculated ${result.riskState} at ${result.riskScore}/100`);
    }
    return result;
  }
  const first = makeIntent('RISK', { amount: 8_500, recipient: 'CloudGrid' });
  const incidentId = `RISK-${state.intentSequence}`;
  state.engine.processIntent(first, { incidentId });
  const retry = makeIntent('RISK-RETRY', { amount: 900, recipient: 'CloudGrid' });
  const result = state.engine.processIntent(retry, { incidentId });
  if (present) {
    renderAll();
    toast(`Risk Governor calculated ${result.riskState} at ${result.riskScore}/100`);
  }
  return result;
}

function clearPendingTimer(hide = true) {
  if (state.countdownId) clearInterval(state.countdownId);
  state.countdownId = null;
  if (hide) $('#pendingBanner').classList.add('hidden');
}

function startPending(seconds, { managedByJudge = false } = {}) {
  clearPendingTimer();
  const intent = makeIntent('PENDING', { amount: 1_500, recipient: 'ComputeHub' });
  let result = state.engine.authoriseIntent(intent);
  if (result.decision === 'REQUIRE_APPROVAL') {
    result = state.engine.approveIntent(result.intent.id, {
      ownerId: state.engine.policy.ownerId,
      timestamp: nextTimestamp(),
    });
  }
  if (!result || result.decision !== 'HOLD') {
    afterDecision(result, { attackResult: true });
    return result;
  }
  state.pendingIntentId = result.intent.id;
  state.pendingSeconds = seconds ?? Math.ceil(result.settlementDelayMs / 1_000);
  if (managedByJudge) {
    $('#pendingBanner').classList.add('hidden');
    renderAll();
    return result;
  }
  $('#pendingBanner').classList.remove('hidden');
  setHeroFlow(result);
  $('#countdown').textContent = state.pendingSeconds;
  $('#pendingTrack').style.width = '0%';
  $('.pending-info strong').textContent = `Intent #${result.intent.id}`;
  $('.pending-info small').innerHTML = `${formatINR(result.intent.amount)} → ${result.intent.recipient} · final revalidation in <b id="countdown">${state.pendingSeconds}</b>s`;
  let elapsed = 0;
  requestAnimationFrame(() => { $('#pendingTrack').style.width = '5%'; });
  renderAll();
  state.countdownId = setInterval(() => {
    elapsed += 1;
    state.pendingSeconds -= 1;
    $('#countdown').textContent = Math.max(0, state.pendingSeconds);
    $('#pendingTrack').style.width = `${Math.min(100, (elapsed / (seconds ?? 10)) * 100)}%`;
    if (state.pendingSeconds <= 0) settlePending();
  }, 1_000);
  toast('Intent entered the two-phase settlement queue');
  return result;
}

function settlePending({ present = true } = {}) {
  if (!state.pendingIntentId) return null;
  clearPendingTimer(false);
  const pendingId = state.pendingIntentId;
  const pending = state.engine.getSnapshot().pendingIntents.find(intent => intent.id === pendingId);
  state.pendingIntentId = null;
  const result = pending
    ? state.engine.settleIntent(pendingId)
    : null;
  $('#pendingBanner').classList.add('hidden');
  if (result && present) afterDecision(result, { attackResult: true });
  if (result && !present) renderAll();
  return result;
}

function performOwnerFreeze({ present = true } = {}) {
  const result = state.engine.freezeAgent({
    ownerId: state.engine.policy.ownerId,
    timestamp: nextTimestamp(),
  });
  clearPendingTimer();
  state.pendingIntentId = null;
  renderAll();
  const invalidatedEvent = result.invalidated.at(-1);
  setHeroFlow(invalidatedEvent ?? result.freezeEvent);
  if (invalidatedEvent && present) {
    showAttackResult({ ...invalidatedEvent, fundsMoved: invalidatedEvent.fundsMoved }, { reason: invalidatedEvent.reason });
    toast('Agent frozen — pending intent invalidated before settlement');
  } else if (present) {
    toast('Owner froze all agent financial authority');
  }
  pulseOnce($('#control-centre'), 'freeze-pulse');
  return { result, outcome: invalidatedEvent ?? result.freezeEvent };
}

function freezeAgent() {
  return performOwnerFreeze().outcome;
}

function activateCapsule() {
  const budget = Number($('#capsuleBudget').value);
  const cap = Number($('#capsuleCap').value);
  const task = $('#capsuleTask').value.trim();
  const vendors = $$('.chip.selected').map(chip => chip.textContent);
  const expiryValue = $('#capsuleExpiry').value;
  try {
    const result = state.engine.activatePolicy({
      task,
      totalTaskBudget: budget,
      dailyCumulativeCap: budget,
      perTransactionCap: cap,
      approvedRecipients: vendors,
      expiresAt: new Date(`${expiryValue}:00Z`).toISOString(),
    }, {
      ownerId: state.engine.policy.ownerId,
      timestamp: nextTimestamp(),
      resetBudget: true,
    });
    $('#capsuleTitle').textContent = task.replace(/^Purchase /i, '').replace(/\b\w/g, character => character.toUpperCase());
    $('#capsuleSummary').textContent = `${state.engine.policy.authorisedAgentId} may spend up to ${formatINR(budget)} for “${task}”, only through ${vendors.join(' and ')}, until the configured expiry.`;
    $('#capsuleBudgetDisplay').textContent = formatINR(budget);
    $('#capsuleCapDisplay').textContent = formatINR(cap);
    renderAll();
    toast(`${result.policy.id}-V${result.policy.version} activated by the owner`);
    return result;
  } catch (error) {
    toast(error.message);
    return { decision: 'BLOCK', reason: error.message };
  }
}

function runTwin() {
  state.twinTimers.forEach(timer => clearTimeout(timer));
  state.twinTimers = [];
  const runButton = $('#runTwin');
  runButton.disabled = true;
  runButton.textContent = 'REPLAYING SAME ATTACK SUITE…';
  $('#twinSummary').classList.add('hidden');
  $('.twin-replay-grid .policy-card.strong')?.classList.remove('twin-winner');
  state.twinResults = runPolicyDigitalTwin();
  const model = createTwinReplayModel(state.twinResults);
  const replayMarkup = side => model.stages.map(stage => {
    const outcome = stage[side];
    return `<div class="twin-replay-row" data-stage="${stage.index}">
      <span>${String(stage.index + 1).padStart(2, '0')}</span><b>${escapeHTML(stage.name)}</b>
      <em data-decision>${escapeHTML(outcome.decision)}</em><small data-funds>${escapeHTML(formatINR(outcome.fundsMoved))}</small>
    </div>`;
  }).join('');
  $('#v1Replay').innerHTML = replayMarkup('legacy');
  $('#v2Replay').innerHTML = replayMarkup('hardened');
  $('#twinStageDots').innerHTML = model.stages.map(stage => `<i data-stage="${stage.index}"></i>`).join('');
  $('#twinStageLabel').textContent = 'SYNCHRONISED REQUEST';
  $('#twinSyncClock').textContent = `STAGE 0 / ${model.totalAttacks}`;
  $('#v1Loss').textContent = formatINR(0);
  $('#v2Loss').textContent = formatINR(0);
  $('#v1Result').textContent = 'REPLAY IN PROGRESS';
  $('#v2Result').textContent = 'REPLAY IN PROGRESS';

  model.stages.forEach((stage, index) => {
    const delay = reducedMotion() ? 0 : 120 + index * 150;
    state.twinTimers.push(setTimeout(() => {
      $$('.twin-replay-row').forEach(row => row.classList.toggle('active', Number(row.dataset.stage) === index));
      $$('#twinStageDots i').forEach(dot => {
        const dotIndex = Number(dot.dataset.stage);
        dot.classList.toggle('active', dotIndex === index);
        dot.classList.toggle('complete', dotIndex < index);
      });
      $('#twinStageLabel').textContent = `EVALUATING · ${stage.name.toUpperCase()}`;
      $('#twinSyncClock').textContent = `STAGE ${index + 1} / ${model.totalAttacks}`;
      $('#v1Loss').textContent = formatINR(stage.legacy.cumulativeMoved);
      $('#v2Loss').textContent = formatINR(stage.cumulativeLossPrevented);
    }, delay));
  });

  const completionDelay = reducedMotion() ? 0 : 120 + model.stages.length * 150;
  state.twinTimers.push(setTimeout(() => {
    $$('.twin-replay-row').forEach(row => row.classList.remove('active'));
    $$('#twinStageDots i').forEach(dot => { dot.classList.remove('active'); dot.classList.add('complete'); });
    $('#twinStageLabel').textContent = 'REPLAY COMPLETE · SAME ENGINE ATTACK SUITE';
    $('#twinSyncClock').textContent = `${model.totalAttacks} / ${model.totalAttacks} VERIFIED`;
    $('#v1Result').textContent = `${model.legacyBypassed} OF ${model.totalAttacks} ATTACKS BYPASSED`;
    $('#v1Result').style.color = model.legacyBypassed ? 'var(--red)' : 'var(--green)';
    $('#v2Result').textContent = `${model.hardenedBypassed} OF ${model.totalAttacks} ATTACKS BYPASSED`;
    $('#v2Result').style.color = model.hardenedBypassed ? 'var(--red)' : 'var(--green)';
    $('.twin-replay-grid .policy-card.strong')?.classList.add('twin-winner');
    const summary = $('#twinSummary');
    summary.classList.remove('hidden');
    $('strong', summary).textContent = `AEGIS V2 contained ${model.totalAttacks - model.hardenedBypassed} of ${model.totalAttacks} attacks using the canonical engine.`;
    $('small', summary).textContent = `V1 moved ${formatINR(model.legacyMoved)}; V2 moved ${formatINR(model.hardenedMoved)}. Simulated loss prevented: ${formatINR(model.lossPrevented)}.`;
    runButton.disabled = false;
    runButton.textContent = 'RUN SYNCHRONISED ATTACK REPLAY';
    toast('Both policy configurations completed the same six engine-driven attacks');
  }, completionDelay));
  return state.twinResults;
}

function eventTitle(event) {
  return ledgerPresentation(event).title;
}

function renderForensics() {
  const ledger = state.engine.getLedger();
  const timeline = $('#forensicTimeline');
  renderIncidentScrubber(ledger);
  if (ledger.length === 0) {
    timeline.innerHTML = '<div class="timeline-item active"><span class="timeline-time">—</span><div class="timeline-point"><span></span></div><div class="timeline-content"><strong>No recorded events</strong><small>Run a scenario to create replayable evidence.</small></div></div>';
    $('#proofTerminal').textContent = '$ aegis verify --latest\n\nNo recorded policy event.\nReset state is deterministic and uses simulated funds only.';
    return;
  }
  state.replayIndex = Math.max(0, Math.min(ledger.length - 1, state.replayIndex));
  const visible = ledger.slice(-18);
  const offset = ledger.length - visible.length;
  timeline.innerHTML = visible.map((event, index) => {
    const ledgerIndex = offset + index;
    return `<div class="timeline-item ${ledgerIndex === state.replayIndex ? 'active' : ''}" data-replay-index="${ledgerIndex}">
      <span class="timeline-time">${displayTime(event.timestamp)}</span>
      <div class="timeline-point"><span></span></div>
      <div class="timeline-content"><strong>${escapeHTML(eventTitle(event))}</strong><small>${escapeHTML(event.reason)}</small></div>
    </div>`;
  }).join('');
  renderProofTerminal(ledger[state.replayIndex]);
}

function renderIncidentScrubber(ledger) {
  const stages = createIncidentStages(ledger);
  $('#incidentScrubber').innerHTML = stages.map(stage => `<button type="button" class="incident-stage${stage.index === state.replayIndex ? ' active' : ''}" ${stage.available ? `data-replay-index="${stage.index}"` : 'disabled'}>
    <i aria-hidden="true"></i><span>${escapeHTML(stage.label)}</span><small>${stage.available ? escapeHTML(displayTime(stage.event.timestamp)) : 'NOT YET RECORDED'}</small>
  </button>`).join('');
}

function renderProofTerminal(event) {
  const rules = event.rulesEvaluated.map(rule => `${rule.passed ? 'PASS' : 'FAIL'} ${rule.rule}: ${rule.reason}`).join('\n                ');
  const signals = Object.entries(event.riskSignals).map(([key, value]) => `${key}=${value}`).join(' · ');
  const intent = event.intent;
  const terminal = $('#proofTerminal');
  const changed = terminal.dataset.eventId !== event.id;
  terminal.dataset.eventId = event.id;
  terminal.textContent = `$ aegis verify --event ${event.id}\n\nINTENT         ${intent?.id ?? 'N/A'}\nAGENT          ${event.agent}\nOWNER          ${event.owner}\nTASK           ${event.activeTask.id} · ${event.activeTask.name}\nPOLICY         ${event.policyLabel} (active version ${event.policyVersion})\nEVENT          ${event.eventType}\nTIMESTAMP      ${event.timestamp}\nDECISION       ${event.decision}\nRULE           ${event.ruleChecked}\nRULE TRACE     ${rules || 'No transaction rules required'}\nRISK STATE     ${event.riskState} (${event.riskScore}/100)\nRISK SIGNALS   ${signals}\nOWNER ACTION   ${event.ownerAction ?? 'NONE'}\nFINAL STATUS   ${event.finalSettlementStatus}\nFUNDS MOVED    ${formatINR(event.fundsMoved)} (simulated)\n\n✓ Decision trace recorded\n✓ Policy version recorded\n✓ Final settlement evidence recorded`;
  if (changed) pulseOnce(terminal, 'terminal-reveal');
}

function stepReplay(delta) {
  const length = state.engine.getLedger().length;
  if (!length) return;
  state.replayIndex = Math.max(0, Math.min(length - 1, state.replayIndex + delta));
  renderForensics();
}

function playReplay() {
  const length = state.engine.getLedger().length;
  if (!length) return;
  clearInterval(state.replayTimer);
  state.replayIndex = 0;
  renderForensics();
  $('#replayPlay').textContent = 'Playing…';
  state.replayTimer = setInterval(() => {
    if (state.replayIndex >= length - 1) {
      clearInterval(state.replayTimer);
      $('#replayPlay').textContent = 'Play Replay';
      return;
    }
    state.replayIndex += 1;
    renderForensics();
  }, 650);
}

function switchView(view) {
  $$('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === view));
  $$('.view-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === view));
  const labels = { overview: 'OVERVIEW', capsules: 'BUDGET CAPSULES', risk: 'RISK GOVERNOR', twin: 'POLICY TWIN', attack: 'ATTACK LAB', forensics: 'FORENSICS' };
  const titles = { overview: 'Autonomous Agent Command Centre', capsules: 'Purpose-Locked Financial Authority', risk: 'Behaviour-Adaptive Financial Defence', twin: 'Pre-Deployment Policy Simulation', attack: 'Adversarial Transaction Testing', forensics: 'Evidence-Backed Incident Replay' };
  $('#currentViewLabel').textContent = labels[view];
  $('#controlTitle').textContent = titles[view];
}

function resetEnvironment({ notify = true, preserveView = false, resetJudge = true } = {}) {
  clearPendingTimer();
  clearInterval(state.replayTimer);
  state.twinTimers.forEach(timer => clearTimeout(timer));
  if (resetJudge) judgeMachine.reset({ preserveOpen: false });
  else judgeMachine.clearAsync();
  cancelMetricAnimations();
  createEngine();
  Object.assign(state, {
    pendingSeconds: 0,
    pendingIntentId: null,
    countdownId: null,
    replayIndex: 0,
    replayTimer: null,
    eventCursor: 0,
    twinResults: null,
    twinTimers: [],
    judgeEvidence: new Map(),
    judgeView: null,
    renderedEventIds: new Set(),
  });
  $('#pendingBanner').classList.add('hidden');
  $('#pendingTrack').style.width = '0%';
  $('#countdown').textContent = '10';
  $('#attackStatus').classList.remove('hidden');
  $('#attackCluster').classList.add('hidden');
  $('#enforcementResult').classList.add('hidden');
  $('#v1Result').textContent = 'Not tested';
  $('#v1Result').style.color = '';
  $('#v2Result').textContent = 'Not tested';
  $('#v2Result').style.color = '';
  $('#v1Replay').innerHTML = '';
  $('#v2Replay').innerHTML = '';
  $('#v1Loss').textContent = '₹0';
  $('#v2Loss').textContent = '₹0';
  $('#twinStageDots').innerHTML = '';
  $('#twinStageLabel').textContent = 'SYNCHRONISED REQUEST';
  $('#twinSyncClock').textContent = 'STAGE 0 / 6';
  $('.twin-replay-grid .policy-card.strong')?.classList.remove('twin-winner');
  $('#runTwin').disabled = false;
  $('#runTwin').textContent = 'RUN SYNCHRONISED ATTACK REPLAY';
  $('#twinSummary').classList.add('hidden');
  $('#replayPlay').textContent = 'Play Replay';
  $('#capsuleTask').value = DEFAULT_POLICY.task;
  $('#capsuleBudget').value = DEFAULT_POLICY.totalTaskBudget;
  $('#capsuleCap').value = DEFAULT_POLICY.perTransactionCap;
  $('#capsuleExpiry').value = '2026-08-02T18:00';
  $$('.chip').forEach(chip => chip.classList.toggle('selected', DEFAULT_POLICY.approvedRecipients.includes(chip.textContent)));
  $('#capsuleTitle').textContent = 'Cloud Infrastructure Procurement';
  $('#capsuleSummary').textContent = 'Procurement-07 may spend up to ₹10,000 on cloud infrastructure, only through CloudGrid and ComputeHub, until 18:00.';
  $('#capsuleBudgetDisplay').textContent = '₹10,000';
  $('#capsuleCapDisplay').textContent = '₹2,500';
  $('#proofTerminal').dataset.eventId = '';
  setHeroFlow();
  renderAll();
  if (resetJudge && !$('#judgeModal').classList.contains('hidden')) {
    $('#judgeModal').classList.add('hidden');
    document.body.classList.remove('judge-open');
    setPageInert(false);
  }
  if (!preserveView) switchView('overview');
  if (notify) toast('Demo environment restored to its deterministic baseline');
}

function executeScenario(name) {
  if (name === 'safe') return runSafe();
  if (name === 'overspend') return runOverspend();
  if (name === 'unknown') return runUnknown();
  if (name === 'evasion') return runEvasion();
  if (name === 'rapid') return runRapid();
  if (name === 'pending') return startPending();
  return null;
}

const judgeDelay = milliseconds => reducedMotion() ? 0 : milliseconds;

function setPageInert(inert) {
  $$('body > header, body > main, body > footer').forEach(element => {
    element.inert = inert;
    if (inert) element.setAttribute('aria-hidden', 'true');
    else element.removeAttribute('aria-hidden');
  });
}

function authorisationEventFor(result) {
  if (!result?.intent?.id) return null;
  return state.engine.getLedger().find(event => event.intent?.id === result.intent.id && event.eventType === 'AUTHORISATION') ?? null;
}

function normaliseLedgerResult(event) {
  return {
    decision: event.decision,
    intent: event.intent,
    ruleChecked: event.ruleChecked,
    rulePassed: !event.rulesEvaluated.some(rule => !rule.passed),
    reason: event.reason,
    activePolicyVersion: event.policyVersion,
    riskState: event.riskState,
    riskScore: event.riskScore,
    fundsMoved: event.fundsMoved,
    timestamp: event.timestamp,
    rulesEvaluated: event.rulesEvaluated,
    ledgerEvent: event,
  };
}

function judgeFlowFor(result) {
  return createCoreVisualState(result).flow;
}

function makeJudgeView(result, {
  title = displayDecision(result.decision),
  detail = result.reason,
  facts = [],
  visual = '',
  pipeline = null,
  authorisationEvent = authorisationEventFor(result),
} = {}) {
  return {
    result,
    title,
    detail,
    facts,
    visual,
    pipeline: pipeline ?? deriveDecisionPipeline(result, authorisationEvent),
    trace: extractRuleTrace(result),
    flow: judgeFlowFor(result),
    currentRule: result.ruleChecked,
    policyVersion: result.activePolicyVersion ?? result.ledgerEvent?.policyVersion,
    riskState: result.riskState,
    riskScore: result.riskScore,
  };
}

function renderJudgeFacts(facts = []) {
  $('#judgeFacts').innerHTML = facts.map(({ label, value, tone = '' }) => `<div class="${escapeHTML(tone)}"><small>${escapeHTML(label)}</small><b>${escapeHTML(value)}</b></div>`).join('');
}

function renderJudgePipeline(pipeline = [], activeStage = null) {
  const icons = { passed: '✓', failed: '■', hold: 'Ⅱ', idle: '○', active: '→' };
  $('#judgePipeline').innerHTML = pipeline.map((stage, index) => {
    let status = stage.status;
    if (activeStage !== null) {
      if (index === activeStage) status = 'active';
      if (index > activeStage) status = 'idle';
    }
    return `<li class="${status}" aria-label="${escapeHTML(`${stage.label}: ${status}`)}"><i aria-hidden="true">${icons[status]}</i><div><b>${escapeHTML(stage.label)}</b><small>${escapeHTML(stage.detail)}</small></div></li>`;
  }).join('');
}

function renderJudgeTrace(trace = []) {
  const toggle = $('#judgeTraceToggle');
  const panel = $('#judgeRuleTrace');
  toggle.classList.toggle('hidden', trace.length === 0);
  panel.innerHTML = trace.map((rule, index) => `<div class="${rule.passed ? 'passed' : 'failed'}"><span>${String(index + 1).padStart(2, '0')}</span><b>${rule.passed ? 'PASS' : 'FAIL'} · ${escapeHTML(rule.rule)}</b><p>${escapeHTML(rule.reason)}</p></div>`).join('');
}

function renderJudgeView(view, { activeStage = null, statusText = null } = {}) {
  state.judgeView = view;
  applyCoreVisualState($('#judgeVisual'), view.result, activeStage === null ? view.flow : 'running');
  $('#judgeCurrentRule').textContent = view.currentRule ?? 'NOT APPLICABLE';
  $('#judgePolicyVersion').textContent = view.policyVersion ? `PROCUREMENT-V${view.policyVersion}` : state.engine.getSnapshot().policyLabel;
  $('#judgeRiskState').textContent = `${view.riskState ?? 'NORMAL'} · ${view.riskScore ?? 0}/100`;
  $('#judgeScenarioVisual').innerHTML = view.visual;
  renderJudgeFacts(view.facts);
  renderJudgePipeline(view.pipeline, activeStage);
  renderJudgeTrace(view.trace);
  const result = $('#judgeResult');
  result.className = `judge-result ${activeStage !== null ? 'running' : decisionClass(view.result.decision)}`;
  result.innerHTML = `<strong>${escapeHTML(statusText ?? view.title)}</strong><span>${escapeHTML(view.detail)}</span><small>FUNDS MOVED · ${escapeHTML(formatINR(view.result.fundsMoved))} · SIMULATED ONLY</small>`;
}

function renderJudgeControls() {
  const snapshot = judgeMachine.snapshot();
  const scenario = JUDGE_SCENARIOS[snapshot.scenarioIndex];
  const badge = $('#judgeStateBadge');
  const readableState = snapshot.status === JUDGE_MODE_STATES.AWAITING_OWNER_ACTION ? 'AWAITING OWNER' : snapshot.status;
  badge.textContent = readableState;
  badge.className = `judge-state-badge ${snapshot.status.toLowerCase().replaceAll('_', '-')}`;
  $('#judgeCard').setAttribute('aria-busy', String(snapshot.status === JUDGE_MODE_STATES.RUNNING));
  $('#judgePrev').disabled = !snapshot.canPrevious;
  $('#judgeNext').disabled = snapshot.status === JUDGE_MODE_STATES.RUNNING;
  $('#judgeRestart').disabled = snapshot.status === JUDGE_MODE_STATES.RUNNING;
  $('#judgeRestart').classList.toggle('hidden', snapshot.scenarioIndex !== 4 && snapshot.status !== JUDGE_MODE_STATES.ERROR);

  if (snapshot.status === JUDGE_MODE_STATES.READY) $('#judgeNext').textContent = 'RUN SCENARIO';
  if (snapshot.status === JUDGE_MODE_STATES.RUNNING) $('#judgeNext').textContent = 'EVALUATING…';
  if (snapshot.status === JUDGE_MODE_STATES.AWAITING_OWNER_ACTION) $('#judgeNext').textContent = 'ACTIVATE KILL SWITCH';
  if (snapshot.status === JUDGE_MODE_STATES.ERROR) $('#judgeNext').textContent = 'RESTART SCENARIO';
  if (snapshot.status === JUDGE_MODE_STATES.COMPLETE) $('#judgeNext').textContent = snapshot.scenarioIndex === JUDGE_SCENARIOS.length - 1 ? 'OPEN FORENSIC PROOF' : 'NEXT SCENARIO';
  $('#judgeNext').setAttribute('aria-label', `${$('#judgeNext').textContent}: ${scenario.title}`);
}

function updateJudgeModal() {
  const snapshot = judgeMachine.snapshot();
  const scenario = JUDGE_SCENARIOS[snapshot.scenarioIndex];
  $('#judgeProgress').textContent = `SCENARIO ${snapshot.scenarioIndex + 1} OF ${JUDGE_SCENARIOS.length}`;
  $('#judgeNumber').textContent = scenario.number;
  $('#judgeFeature').textContent = scenario.feature;
  $('#judgeTitle').textContent = scenario.title;
  $('#judgeDescription').textContent = scenario.description;
  $('#judgeAmount').textContent = scenario.amount;
  applyCoreVisualState($('#judgeVisual'));
  $('#judgeCard').classList.remove('kill-choreography');
  $('#judgeCurrentRule').textContent = 'NOT STARTED';
  const baseline = state.engine.getSnapshot();
  $('#judgePolicyVersion').textContent = baseline.policyLabel;
  $('#judgeRiskState').textContent = `${baseline.risk.state} · ${baseline.risk.score}/100`;
  $('#judgeScenarioVisual').innerHTML = '';
  $('#judgeFacts').innerHTML = '';
  renderJudgePipeline([
    { label: 'INTENT RECEIVED', status: 'idle', detail: 'Waiting to start' },
    { label: 'POLICY EVALUATION', status: 'idle', detail: 'Not reached' },
    { label: 'AUTHORISATION', status: 'idle', detail: 'Not reached' },
    { label: 'FINAL REVALIDATION', status: 'idle', detail: 'Not reached' },
  ]);
  $('#judgeResult').className = 'judge-result';
  $('#judgeResult').innerHTML = '<strong>READY</strong><span>Waiting for the presenter to run the actual engine scenario.</span><small>ALL AMOUNTS ARE SIMULATED</small>';
  $('#judgeTraceToggle').classList.add('hidden');
  $('#judgeTraceToggle').setAttribute('aria-expanded', 'false');
  $('#judgeRuleTrace').classList.add('hidden');
  $('#judgeRuleTrace').innerHTML = '';
  state.judgeView = null;
  renderJudgeControls();
}

function guardJudgeCallback(callback, token) {
  return () => {
    try {
      callback();
    } catch (error) {
      showJudgeError(error, token);
    }
  };
}

function playJudgeResult(view, token, { awaitingOwner = false } = {}) {
  state.judgeView = view;
  renderJudgeView(view, { activeStage: 0, statusText: 'INTENT RECEIVED' });
  renderJudgeControls();
  judgeMachine.schedule(guardJudgeCallback(() => renderJudgeView(view, { activeStage: 1, statusText: `EVALUATING · ${view.currentRule}` }), token), judgeDelay(160), token);
  judgeMachine.schedule(guardJudgeCallback(() => {
    renderJudgeView(view);
    if (awaitingOwner) beginJudgeOwnerWindow(view, token);
    else judgeMachine.complete(token);
    renderJudgeControls();
  }, token), judgeDelay(420), token);
}

function recordEvasionEvidence(beforeRisk, ledgerStart, result) {
  const afterRisk = state.engine.getSnapshot().risk;
  const events = state.engine.getLedger().slice(ledgerStart);
  const intents = events.filter(event => event.intent?.id.includes('SPLIT')).map(event => event.intent);
  const uniqueIntents = [...new Map(intents.map(intent => [intent.id, intent])).values()];
  state.judgeEvidence.set(2, { result, beforeRisk, afterRisk, events, intents: uniqueIntents });
  return state.judgeEvidence.get(2);
}

function scenarioOneView(result) {
  const authorisation = authorisationEventFor(result);
  return makeJudgeView(result, {
    title: 'SETTLED AFTER FINAL REVALIDATION',
    facts: [
      { label: 'APPROVED RECIPIENT', value: result.intent.recipient, tone: 'passed' },
      { label: 'REQUEST / CAP', value: `${formatINR(result.intent.amount)} / ${formatINR(state.engine.policy.perTransactionCap)}` },
      { label: 'PHASE 1', value: authorisation?.finalSettlementStatus ?? 'PENDING_SETTLEMENT', tone: 'hold' },
      { label: 'PHASE 2', value: result.intent.status, tone: 'passed' },
    ],
    visual: '<div class="judge-payment-path passed"><span>ALLOWLIST MATCH</span><i>→</i><span>CAP RESPECTED</span><i>→</i><span>SETTLED</span></div>',
    authorisationEvent: authorisation,
  });
}

function scenarioTwoView(result) {
  const cap = state.engine.policy.perTransactionCap;
  return makeJudgeView(result, {
    title: 'BLOCKED AT AEGIS',
    facts: [
      { label: 'REQUESTED', value: formatINR(result.intent.amount) },
      { label: 'CURRENT CAP', value: formatINR(cap) },
      { label: 'EXACT EXCESS', value: formatINR(result.intent.amount - cap), tone: 'failed' },
      { label: 'FIRST FAILING RULE', value: result.rulesEvaluated.find(rule => !rule.passed)?.rule ?? result.ruleChecked, tone: 'failed' },
    ],
    visual: `<div class="judge-limit"><span>${escapeHTML(formatINR(result.intent.amount))} REQUEST</span><i>−</i><span>${escapeHTML(formatINR(cap))} CAP</span><b>= ${escapeHTML(formatINR(result.intent.amount - cap))} EXCESS</b></div>`,
  });
}

function scenarioThreeView(result, evidence) {
  const cluster = createEvasionClusterModel(evidence.intents, result);
  return makeJudgeView(result, {
    title: 'COORDINATED ATTACK BLOCKED',
    facts: [
      { label: 'INDIVIDUAL INTENTS', value: evidence.intents.map(intent => formatINR(intent.amount)).join(' · ') },
      { label: 'GROUPED VALUE', value: formatINR(cluster.total), tone: 'failed' },
      { label: 'OBSERVED WINDOW', value: `${cluster.windowSeconds}s / ${Math.round(state.engine.policy.evasionWindowMs / 1_000)}s detection window` },
      { label: 'ENGINE RESULT', value: 'ONE COORDINATED ATTACK', tone: 'failed' },
    ],
    visual: evasionClusterMarkup(cluster, { compact: true }),
  });
}

function scenarioFourView(evidence) {
  if (!evidence) throw new Error('Risk evidence is unavailable. Restart this scenario to rebuild the deterministic sequence.');
  const before = evidence.beforeRisk;
  const after = evidence.afterRisk;
  const signals = Object.entries(after.signals)
    .map(([key, value]) => ({ key, before: before.signals[key], after: value }))
    .filter(signal => signal.before !== signal.after);
  const result = evidence.result;
  return makeJudgeView(result, {
    title: `${before.state} → ${after.state}`,
    detail: after.response,
    facts: [
      { label: 'ORIGINAL STATE', value: `${before.state} · ${before.score}/100` },
      { label: 'SIGNALS ADDED', value: signals.map(signal => `${signal.key}: ${signal.before}→${signal.after}`).join(' · '), tone: 'hold' },
      { label: 'CALCULATED SCORE', value: `${after.score}/100`, tone: 'failed' },
      { label: 'AUTOMATIC RESTRICTIONS', value: after.response, tone: 'failed' },
    ],
    visual: `<div class="judge-risk-transition"><span>${escapeHTML(before.state)}<small>${before.score}/100</small></span><i>→</i><b>${escapeHTML(after.state)}<small>${after.score}/100</small></b></div>`,
  });
}

function scenarioFivePendingView(result) {
  const seconds = Math.ceil(result.settlementDelayMs / 1_000);
  return makeJudgeView(result, {
    title: 'PENDING SETTLEMENT · OWNER CONTROL AVAILABLE',
    detail: 'Phase 1 passed. Activate the owner kill switch before final revalidation, or allow the real engine settlement to occur.',
    facts: [
      { label: 'PHASE 1', value: 'AUTHORISED', tone: 'passed' },
      { label: 'FINAL STATUS', value: result.intent.status, tone: 'hold' },
      { label: 'POLICY VERSION', value: `PROCUREMENT-V${result.activePolicyVersion}` },
      { label: 'FUNDS MOVED', value: formatINR(result.fundsMoved), tone: 'hold' },
    ],
    visual: `<div class="judge-countdown"><small>FINAL REVALIDATION IN</small><b id="judgeSettlementCountdown">${seconds}</b><span>SECONDS · OWNER WINDOW OPEN</span></div>`,
    authorisationEvent: result.ledgerEvent,
  });
}

function scenarioSixView(evidence) {
  if (!evidence) throw new Error('No ledger evidence is available. Restart the demo and run a policy scenario first.');
  const result = normaliseLedgerResult(evidence.event);
  return makeJudgeView(result, {
    title: 'ORDERED ENGINE EVIDENCE READY',
    detail: evidence.reason,
    facts: [
      { label: 'LEDGER EVENTS', value: String(evidence.ledgerEventCount) },
      { label: 'SELECTED EVENT / INTENT', value: `${evidence.selectedEventId} / ${evidence.intentId}` },
      { label: 'POLICY / RULE', value: `${evidence.policyLabel} / ${evidence.rule}` },
      { label: 'OWNER ACTION / FINAL', value: `${evidence.ownerAction} / ${evidence.finalStatus} / ${formatINR(evidence.fundsMoved)}` },
    ],
    visual: `<pre class="judge-terminal">$ aegis verify --event ${escapeHTML(evidence.selectedEventId)}\nDECISION  ${escapeHTML(evidence.decision)}\nRULE      ${escapeHTML(evidence.rule)}\nSTATUS    ${escapeHTML(evidence.finalStatus)}\nFUNDS     ${escapeHTML(formatINR(evidence.fundsMoved))} (SIMULATED)</pre>`,
  });
}

function beginJudgeOwnerWindow(view, token) {
  if (!judgeMachine.awaitOwnerAction(token)) return;
  state.pendingSeconds = Math.ceil(view.result.settlementDelayMs / 1_000);
  renderJudgeControls();
  judgeMachine.every(guardJudgeCallback(() => {
    state.pendingSeconds -= 1;
    const countdown = $('#judgeSettlementCountdown');
    if (countdown) countdown.textContent = Math.max(0, state.pendingSeconds);
    if (state.pendingSeconds <= 0) settleJudgePending(token);
  }, token), 1_000, token);
}

function settleJudgePending(token) {
  if (!judgeMachine.resumeFromOwnerAction(token)) return;
  judgeMachine.clearAsync();
  const result = settlePending({ present: false });
  if (!result) return showJudgeError(new Error('The pending intent was no longer available for final revalidation.'), token);
  const view = makeJudgeView(result, {
    title: 'SETTLED · OWNER DID NOT FREEZE',
    detail: result.reason,
    facts: [
      { label: 'OWNER ACTION', value: 'NO FREEZE BEFORE EXPIRY' },
      { label: 'FINAL REVALIDATION', value: result.rulePassed ? 'PASSED' : 'FAILED', tone: result.rulePassed ? 'passed' : 'failed' },
      { label: 'FINAL STATUS', value: result.intent.status, tone: result.decision === 'APPROVE' ? 'passed' : 'failed' },
      { label: 'FUNDS MOVED', value: `${formatINR(result.fundsMoved)} · SIMULATED`, tone: result.fundsMoved ? 'passed' : 'failed' },
    ],
    authorisationEvent: state.judgeEvidence.get(4)?.pending?.ledgerEvent,
  });
  renderJudgeView(view);
  judgeMachine.complete(token);
  renderJudgeControls();
}

function activateJudgeKillSwitch() {
  const snapshot = judgeMachine.snapshot();
  if (snapshot.status !== JUDGE_MODE_STATES.AWAITING_OWNER_ACTION || snapshot.scenarioIndex !== 4) return;
  const token = snapshot.runToken;
  if (!judgeMachine.resumeFromOwnerAction(token)) return;
  judgeMachine.clearAsync();
  renderJudgeControls();
  try {
    const oldVersion = state.engine.policy.version;
    const { outcome } = performOwnerFreeze({ present: false });
    const result = normaliseLedgerResult(outcome);
    const newVersion = state.engine.policy.version;
    const view = makeJudgeView(result, {
      title: 'FINANCIAL AUTHORITY REVOKED',
      detail: `PENDING INTENT INVALIDATED. ${result.reason}`,
      facts: [
        { label: 'OWNER ACTION', value: 'KILL SWITCH · VERIFIED OWNER', tone: 'failed' },
        { label: 'POLICY VERSION', value: `V${oldVersion} → V${newVersion}`, tone: 'failed' },
        { label: 'FINAL STATUS', value: outcome.finalSettlementStatus, tone: 'failed' },
        { label: 'FUNDS MOVED', value: `${formatINR(outcome.fundsMoved)} · SIMULATED`, tone: 'passed' },
      ],
      visual: '<div class="judge-revocation"><span>PHASE 1 AUTHORISED</span><i>→</i><b>OWNER FREEZE</b><i>⊣</i><span>WALLET NOT REACHED</span></div><div class="revocation-verdict"><strong>PENDING INTENT INVALIDATED</strong><span>FUNDS MOVED: ₹0</span></div>',
      authorisationEvent: state.judgeEvidence.get(4)?.pending?.ledgerEvent,
    });
    renderJudgeView(view);
    pulseOnce($('#judgeCard'), 'kill-choreography');
    judgeMachine.complete(token);
    renderJudgeControls();
  } catch (error) {
    showJudgeError(error, token);
  }
}

function executeJudgeScenario() {
  const snapshot = judgeMachine.snapshot();
  if (snapshot.status !== JUDGE_MODE_STATES.READY) return;
  const token = judgeMachine.start();
  if (!token) return;
  renderJudgeControls();
  applyCoreVisualState($('#judgeVisual'), null, 'running');
  $('#judgeResult').className = 'judge-result running';
  $('#judgeResult').innerHTML = '<strong>RUNNING</strong><span>The canonical engine is evaluating the transaction intent.</span><small>NO RESULT IS DISPLAYED UNTIL THE ENGINE RETURNS</small>';
  try {
    let view;
    if (snapshot.scenarioIndex === 0) view = scenarioOneView(runSafe({ present: false }));
    if (snapshot.scenarioIndex === 1) view = scenarioTwoView(runOverspend({ present: false }));
    if (snapshot.scenarioIndex === 2) {
      const beforeRisk = state.engine.getSnapshot().risk;
      const ledgerStart = state.engine.getLedger().length;
      const result = runEvasion({ present: false });
      view = scenarioThreeView(result, recordEvasionEvidence(beforeRisk, ledgerStart, result));
    }
    if (snapshot.scenarioIndex === 3) view = scenarioFourView(state.judgeEvidence.get(2));
    if (snapshot.scenarioIndex === 4) {
      const result = startPending(undefined, { managedByJudge: true });
      if (result?.decision !== 'HOLD') throw new Error(result?.reason ?? 'The engine did not create a pending settlement intent.');
      state.judgeEvidence.set(4, { pending: result });
      view = scenarioFivePendingView(result);
      playJudgeResult(view, token, { awaitingOwner: true });
      return;
    }
    if (snapshot.scenarioIndex === 5) {
      const evidence = extractLedgerEvidence(state.engine.getLedger());
      view = scenarioSixView(evidence);
      state.replayIndex = state.engine.getLedger().length - 1;
      renderForensics();
    }
    if (!view) throw new Error('Judge Mode could not resolve the selected scenario.');
    renderAll();
    playJudgeResult(view, token);
  } catch (error) {
    showJudgeError(error, token);
  }
}

function showJudgeError(error, token = judgeMachine.snapshot().runToken) {
  judgeMachine.fail(error, token);
  $('#judgeVisual').dataset.flow = 'blocked';
  $('#judgeResult').className = 'judge-result blocked';
  $('#judgeResult').innerHTML = `<strong>SAFE UI ERROR</strong><span>${escapeHTML(error instanceof Error ? error.message : String(error))}</span><small>ENGINE AND LEDGER EVIDENCE WERE PRESERVED</small>`;
  renderJudgeControls();
}

function rebuildJudgeTo(targetIndex) {
  resetEnvironment({ notify: false, preserveView: true, resetJudge: false });
  if (targetIndex > 0) runSafe({ present: false });
  if (targetIndex > 1) runOverspend({ present: false });
  if (targetIndex > 2) {
    const beforeRisk = state.engine.getSnapshot().risk;
    const ledgerStart = state.engine.getLedger().length;
    const result = runEvasion({ present: false });
    recordEvasionEvidence(beforeRisk, ledgerStart, result);
  }
  renderAll();
  judgeMachine.prepareScenario(targetIndex);
  updateJudgeModal();
}

function restartJudgeScenario() {
  const index = judgeMachine.snapshot().scenarioIndex;
  if (index === 5 && state.engine.getLedger().length) {
    judgeMachine.prepareScenario(index);
    updateJudgeModal();
    return;
  }
  rebuildJudgeTo(index);
}

function previousJudgeScenario() {
  const target = judgeMachine.snapshot().scenarioIndex - 1;
  if (target < 0 || !judgeMachine.snapshot().canPrevious) return;
  rebuildJudgeTo(target);
}

function runJudgePrimaryAction() {
  const snapshot = judgeMachine.snapshot();
  if (snapshot.status === JUDGE_MODE_STATES.READY) return executeJudgeScenario();
  if (snapshot.status === JUDGE_MODE_STATES.AWAITING_OWNER_ACTION) return activateJudgeKillSwitch();
  if (snapshot.status === JUDGE_MODE_STATES.ERROR) return restartJudgeScenario();
  if (snapshot.status !== JUDGE_MODE_STATES.COMPLETE) return;
  if (snapshot.scenarioIndex === JUDGE_SCENARIOS.length - 1) {
    closeJudgeMode();
    switchView('forensics');
    $('#control-centre').scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth' });
    return;
  }
  judgeMachine.next();
  updateJudgeModal();
}

function openJudgeMode() {
  state.judgePreviousFocus = document.activeElement;
  resetEnvironment({ notify: false, preserveView: true, resetJudge: false });
  judgeMachine.open();
  updateJudgeModal();
  $('#judgeModal').classList.remove('hidden');
  document.body.classList.add('judge-open');
  setPageInert(true);
  $('#judgeCard').focus({ preventScroll: true });
}

function closeJudgeMode() {
  judgeMachine.close();
  clearPendingTimer();
  state.pendingIntentId = null;
  $('#judgeModal').classList.add('hidden');
  document.body.classList.remove('judge-open');
  setPageInert(false);
  if (state.judgePreviousFocus?.isConnected) state.judgePreviousFocus.focus();
}

function resetJudgeDemo() {
  resetEnvironment({ notify: false, preserveView: true, resetJudge: false });
  judgeMachine.reset({ preserveOpen: true });
  updateJudgeModal();
  toast('Judge Mode restored to its deterministic baseline');
}

function toggleJudgeTrace() {
  const toggle = $('#judgeTraceToggle');
  const expanded = toggle.getAttribute('aria-expanded') === 'true';
  toggle.setAttribute('aria-expanded', String(!expanded));
  toggle.textContent = expanded ? 'View rule trace' : 'Hide rule trace';
  $('#judgeRuleTrace').classList.toggle('hidden', expanded);
}

function trapJudgeFocus(event) {
  if (event.key !== 'Tab' || $('#judgeModal').classList.contains('hidden')) return;
  const focusable = $$('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])', $('#judgeCard')).filter(element => !element.classList.contains('hidden'));
  if (!focusable.length) return;
  const first = focusable.at(0);
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function initInteractions() {
  createEngine();
  renderAll();
  $$('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
  $$('.scenario-button, .attack-option').forEach(button => button.addEventListener('click', () => executeScenario(button.dataset.scenario)));
  $$('[data-freeze-button]').forEach(button => button.addEventListener('click', freezeAgent));
  $$('.chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('selected')));
  $('#clearEvents').addEventListener('click', () => { state.eventCursor = state.engine.getLedger().length; renderEvents(); });
  $('#resetEnvironment').addEventListener('click', () => resetEnvironment());
  $('#activateCapsule').addEventListener('click', activateCapsule);
  $('#injectRisk').addEventListener('click', injectRisk);
  $('#runTwin').addEventListener('click', runTwin);
  $('#replayPrev').addEventListener('click', () => stepReplay(-1));
  $('#replayNext').addEventListener('click', () => stepReplay(1));
  $('#replayPlay').addEventListener('click', playReplay);
  $('#forensicTimeline').addEventListener('click', event => {
    const item = event.target.closest('[data-replay-index]');
    if (item) {
      state.replayIndex = Number(item.dataset.replayIndex);
      renderForensics();
    }
  });
  $('#incidentScrubber').addEventListener('click', event => {
    const item = event.target.closest('[data-replay-index]');
    if (item) {
      state.replayIndex = Number(item.dataset.replayIndex);
      renderForensics();
    }
  });
  const narrative = $('.narrative-band');
  narrative.classList.add('reveal-statement');
  if (reducedMotion() || !('IntersectionObserver' in window)) narrative.classList.add('is-revealed');
  else {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      narrative.classList.add('is-revealed');
      observer.disconnect();
    }, { threshold: 0.35 });
    observer.observe(narrative);
  }
  $('#launchJudgeMode').addEventListener('click', openJudgeMode);
  $('#launchJudgeModeBottom').addEventListener('click', openJudgeMode);
  $('#closeJudgeMode').addEventListener('click', closeJudgeMode);
  $('#judgeNext').addEventListener('click', runJudgePrimaryAction);
  $('#judgePrev').addEventListener('click', previousJudgeScenario);
  $('#judgeReset').addEventListener('click', resetJudgeDemo);
  $('#judgeRestart').addEventListener('click', restartJudgeScenario);
  $('#judgeTraceToggle').addEventListener('click', toggleJudgeTrace);
  $('.judge-backdrop').addEventListener('click', closeJudgeMode);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#judgeModal').classList.contains('hidden')) closeJudgeMode();
    else trapJudgeFocus(event);
  });
  window.__AEGIS_DIAGNOSTICS__ = Object.freeze({
    judge: () => judgeMachine.snapshot(),
    engine: () => state.engine.getSnapshot(),
    ledger: () => state.engine.getLedger(),
    displayedRuleTrace: () => state.judgeView?.trace.map(rule => ({ ...rule })) ?? [],
    activeView: () => $('.nav-item.active')?.dataset.view ?? null,
    selectedForensicEvent: () => $('#proofTerminal').dataset.eventId || null,
    heroFlow: () => $('#heroFlow').dataset.flow,
    coreVisual: () => ({
      flow: $('#heroFlow').dataset.flow,
      risk: $('#heroFlow').dataset.risk,
      failingLayer: $('#heroFlow').dataset.failLayer,
      walletGate: $('#heroFlow').dataset.walletGate,
    }),
    visualRiskState: () => document.body.dataset.riskState,
    incidentStages: () => createIncidentStages(state.engine.getLedger()).map(stage => ({ id: stage.id, index: stage.index, available: stage.available })),
    twinReplay: () => state.twinResults ? createTwinReplayModel(state.twinResults) : null,
  });
}

document.addEventListener('DOMContentLoaded', initInteractions);
