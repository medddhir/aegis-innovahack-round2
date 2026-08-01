import {
  AegisPolicyEngine,
  DEFAULT_POLICY,
  RULES,
  runPolicyDigitalTwin,
} from './policy-engine.js';

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
  judgeIndex: 0,
  eventCursor: 0,
  twinResults: null,
  twinTimers: [],
  judgeActionTimer: null,
};

const DEMO_START = new Date('2026-08-01T09:42:31.000Z').getTime();
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const formatINR = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const displayTime = value => new Date(value).toLocaleTimeString('en-GB', { hour12: false, timeZone: 'UTC' });
const displayDecision = decision => ({ APPROVE: 'APPROVED', HOLD: 'HOLD', REQUIRE_APPROVAL: 'REQUIRE APPROVAL', BLOCK: 'BLOCKED', INVALIDATE: 'INVALIDATED', FREEZE: 'FROZEN' }[decision] ?? decision);
const decisionClass = decision => decision === 'APPROVE' ? 'approved' : decision === 'HOLD' || decision === 'REQUIRE_APPROVAL' ? 'pending' : 'blocked';
const escapeHTML = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

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
    return { title: 'Owner activated kill switch', detail: event.reason, status: 'FROZEN', kind: 'blocked' };
  }
  if (event.eventType === 'POLICY_ACTIVATED') {
    return { title: 'Budget Capsule activated', detail: event.reason, status: 'ACTIVE', kind: 'system' };
  }
  if (event.eventType === 'POLICY_MODIFICATION_ATTEMPT') {
    return { title: 'Policy modification attempt blocked', detail: event.reason, status: 'BLOCKED', kind: 'blocked' };
  }
  if (event.decision === 'APPROVE') return { title: 'Transaction settled after revalidation', detail: `${amount} · ${event.reason}`, status: 'APPROVED', kind: 'approved' };
  if (event.decision === 'HOLD') return { title: event.ownerAction ? 'Owner approved pending intent' : 'Transaction intent authorised', detail: `${amount} · ${event.reason}`, status: 'PENDING', kind: 'pending' };
  if (event.decision === 'REQUIRE_APPROVAL') return { title: 'Risk Governor requires owner approval', detail: `${amount} · ${event.reason}`, status: 'APPROVAL', kind: 'pending' };
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
    return `<div class="event-item">
      <span class="event-time">${displayTime(event.timestamp)}</span>
      <div class="event-main"><strong>${escapeHTML(item.title)}</strong><small>${escapeHTML(item.detail)}</small></div>
      <span class="event-status ${item.kind}">${escapeHTML(item.status)}</span>
    </div>`;
  }).join('');
}

function renderMetrics() {
  const snapshot = state.engine.getSnapshot();
  $('#budgetRemaining').textContent = formatINR(snapshot.budgetRemaining);
  $('#budgetTotalDisplay').textContent = formatINR(snapshot.policy.totalTaskBudget);
  $('#budgetBar').style.width = `${Math.min(100, (snapshot.taskSpent / snapshot.policy.totalTaskBudget) * 100)}%`;
  $('#protectedValue').textContent = formatINR(snapshot.protectedValue);
  $('#approvedCount').textContent = snapshot.approvedCount;
  $('#blockedCount').textContent = snapshot.blockedCount;
  $('#pendingCount').textContent = snapshot.pendingCount;
  $('#topPolicy').textContent = snapshot.policyLabel;
  $('#capsulePolicyVersion').textContent = `POLICY VERSION · ${snapshot.policyLabel}`;
  $('#capsuleVendorCount').textContent = snapshot.policy.approvedRecipients.length;
  renderRisk();
}

function renderRisk() {
  const { risk } = state.engine.getSnapshot();
  const className = `state-${risk.state.toLowerCase()}`;
  $('#topAgentState').textContent = risk.state;
  $('#topAgentState').className = className;
  $('#stateValue').textContent = risk.state;
  $('#stateValue').className = className;
  $('#riskValue').textContent = risk.score;
  $('#riskBar').style.width = `${risk.score}%`;
  $('#riskBar').style.background = risk.score >= 80 ? 'var(--red)' : risk.score >= 55 ? 'var(--orange)' : risk.score >= 30 ? 'var(--amber)' : 'var(--green)';
  $('#stateOrb span').style.borderColor = risk.score >= 80 ? 'rgba(255,79,102,.45)' : risk.score >= 55 ? 'rgba(255,122,69,.45)' : risk.score >= 30 ? 'rgba(255,184,77,.45)' : 'rgba(66,211,146,.28)';
  $$('.risk-step').forEach(step => step.classList.toggle('active', step.dataset.state === risk.state));

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

function showAttackResult(result, { cluster = false, reason } = {}) {
  $('#attackStatus').classList.add('hidden');
  $('#attackCluster').classList.toggle('hidden', !cluster);
  const panel = $('#enforcementResult');
  panel.classList.remove('hidden');
  $('strong', panel).textContent = displayDecision(result.decision);
  $('p', panel).textContent = reason ?? result.reason;
  $('small', panel).textContent = `Funds moved: ${formatINR(result.fundsMoved)} (simulated)`;
}

function afterDecision(result, options = {}) {
  renderAll();
  if (options.attackResult) showAttackResult(result, options);
  toast(`${displayDecision(result.decision)} · ${result.ruleChecked}`);
  return result;
}

function runSafe() {
  const intent = makeIntent('SAFE', { amount: 1_200, recipient: 'CloudGrid' });
  return afterDecision(state.engine.processIntent(intent));
}

function runOverspend() {
  const intent = makeIntent('OVERSPEND', { amount: 8_500, recipient: 'CloudGrid' });
  return afterDecision(state.engine.processIntent(intent), { attackResult: true });
}

function runUnknown() {
  const intent = makeIntent('UNKNOWN', { amount: 2_000, recipient: '0xF4…91B' });
  return afterDecision(state.engine.processIntent(intent), { attackResult: true });
}

function runEvasion() {
  const intents = Array.from({ length: 4 }, (_, index) => makeIntent('SPLIT', {
    amount: 1_999,
    recipient: 'CloudGrid',
    requestedAt: nextTimestamp(3_000),
  }));
  const results = state.engine.processIntentBatch(intents, { incidentId: `SPLIT-${state.intentSequence}` });
  const result = results.at(-1);
  const total = intents.reduce((sum, intent) => sum + intent.amount, 0);
  return afterDecision(result, {
    attackResult: true,
    cluster: true,
    reason: `${intents.length} related requests were evaluated as one ${formatINR(total)} coordinated attempt. ${result.reason}`,
  });
}

function runRapid() {
  const intents = Array.from({ length: 8 }, () => makeIntent('RAPID', {
    amount: 800,
    requestedAt: nextTimestamp(500),
  }));
  const results = state.engine.processIntentBatch(intents, { incidentId: `RAPID-${state.intentSequence}` });
  return afterDecision(results.at(-1), { attackResult: true });
}

function injectRisk() {
  const currentRisk = state.engine.getSnapshot().risk;
  if (['RESTRICTED', 'QUARANTINED'].includes(currentRisk.state)) {
    const probe = makeIntent('RISK-PROBE', { amount: 900, recipient: 'ComputeHub' });
    const result = state.engine.processIntent(probe);
    renderAll();
    toast(`Risk Governor calculated ${result.riskState} at ${result.riskScore}/100`);
    return result;
  }
  const first = makeIntent('RISK', { amount: 8_500, recipient: 'CloudGrid' });
  const incidentId = `RISK-${state.intentSequence}`;
  state.engine.processIntent(first, { incidentId });
  const retry = makeIntent('RISK-RETRY', { amount: 900, recipient: 'CloudGrid' });
  const result = state.engine.processIntent(retry, { incidentId });
  renderAll();
  toast(`Risk Governor calculated ${result.riskState} at ${result.riskScore}/100`);
  return result;
}

function clearPendingTimer(hide = true) {
  if (state.countdownId) clearInterval(state.countdownId);
  state.countdownId = null;
  if (hide) $('#pendingBanner').classList.add('hidden');
}

function startPending(seconds) {
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
  $('#pendingBanner').classList.remove('hidden');
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

function settlePending() {
  if (!state.pendingIntentId) return null;
  clearPendingTimer(false);
  const pendingId = state.pendingIntentId;
  const pending = state.engine.getSnapshot().pendingIntents.find(intent => intent.id === pendingId);
  state.pendingIntentId = null;
  const result = pending
    ? state.engine.settleIntent(pendingId)
    : null;
  $('#pendingBanner').classList.add('hidden');
  if (result) afterDecision(result, { attackResult: true });
  return result;
}

function freezeAgent() {
  const result = state.engine.freezeAgent({
    ownerId: state.engine.policy.ownerId,
    timestamp: nextTimestamp(),
  });
  clearPendingTimer();
  state.pendingIntentId = null;
  renderAll();
  const invalidatedEvent = result.invalidated.at(-1);
  if (invalidatedEvent) {
    showAttackResult({ ...invalidatedEvent, fundsMoved: invalidatedEvent.fundsMoved }, { reason: invalidatedEvent.reason });
    toast('Agent frozen — pending intent invalidated before settlement');
  } else {
    toast('Owner froze all agent financial authority');
  }
  return invalidatedEvent ?? result.freezeEvent;
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
  const v1 = $('#v1Result');
  const v2 = $('#v2Result');
  v1.textContent = 'Testing…';
  v2.textContent = 'Testing…';
  $('#twinSummary').classList.add('hidden');
  state.twinResults = runPolicyDigitalTwin();
  const { legacy, hardened } = state.twinResults;
  state.twinTimers.push(setTimeout(() => {
    v1.textContent = `${legacy.attacksSucceeded} of ${legacy.attacks.length} attacks succeeded`;
    v1.style.color = legacy.attacksSucceeded ? 'var(--red)' : 'var(--green)';
  }, 450));
  state.twinTimers.push(setTimeout(() => {
    v2.textContent = `${hardened.attacksSucceeded} of ${hardened.attacks.length} attacks succeeded`;
    v2.style.color = hardened.attacksSucceeded ? 'var(--red)' : 'var(--green)';
  }, 750));
  state.twinTimers.push(setTimeout(() => {
    const summary = $('#twinSummary');
    summary.classList.remove('hidden');
    $('strong', summary).textContent = `V2 contained ${hardened.attacksContained} of ${hardened.attacks.length} attacks using the canonical engine.`;
    $('small', summary).textContent = `V1 moved ${formatINR(legacy.attacks.reduce((sum, attack) => sum + attack.fundsMoved, 0))}; V2 moved ${formatINR(hardened.attacks.reduce((sum, attack) => sum + attack.fundsMoved, 0))} in the attack suite.`;
    toast('Both policy configurations completed the same six engine-driven attacks');
  }, 1_000));
  return state.twinResults;
}

function eventTitle(event) {
  return ledgerPresentation(event).title;
}

function renderForensics() {
  const ledger = state.engine.getLedger();
  const timeline = $('#forensicTimeline');
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

function renderProofTerminal(event) {
  const rules = event.rulesEvaluated.map(rule => `${rule.passed ? 'PASS' : 'FAIL'} ${rule.rule}: ${rule.reason}`).join('\n                ');
  const signals = Object.entries(event.riskSignals).map(([key, value]) => `${key}=${value}`).join(' · ');
  const intent = event.intent;
  $('#proofTerminal').textContent = `$ aegis verify --event ${event.id}\n\nINTENT         ${intent?.id ?? 'N/A'}\nAGENT          ${event.agent}\nOWNER          ${event.owner}\nTASK           ${event.activeTask.id} · ${event.activeTask.name}\nPOLICY         ${event.policyLabel} (active version ${event.policyVersion})\nEVENT          ${event.eventType}\nTIMESTAMP      ${event.timestamp}\nDECISION       ${event.decision}\nRULE           ${event.ruleChecked}\nRULE TRACE     ${rules || 'No transaction rules required'}\nRISK STATE     ${event.riskState} (${event.riskScore}/100)\nRISK SIGNALS   ${signals}\nOWNER ACTION   ${event.ownerAction ?? 'NONE'}\nFINAL STATUS   ${event.finalSettlementStatus}\nFUNDS MOVED    ${formatINR(event.fundsMoved)} (simulated)\n\n✓ Decision trace recorded\n✓ Policy version recorded\n✓ Final settlement evidence recorded`;
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

function resetEnvironment() {
  clearPendingTimer();
  clearInterval(state.replayTimer);
  state.twinTimers.forEach(timer => clearTimeout(timer));
  clearTimeout(state.judgeActionTimer);
  createEngine();
  Object.assign(state, {
    pendingSeconds: 0,
    pendingIntentId: null,
    countdownId: null,
    replayIndex: 0,
    replayTimer: null,
    judgeIndex: 0,
    eventCursor: 0,
    twinResults: null,
    twinTimers: [],
    judgeActionTimer: null,
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
  renderAll();
  switchView('overview');
  toast('Demo environment restored to its deterministic baseline');
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

function openJudgeMode() {
  state.judgeIndex = 0;
  updateJudgeModal();
  $('#judgeModal').classList.remove('hidden');
  document.body.style.overflow = 'hidden';
}

function closeJudgeMode() {
  $('#judgeModal').classList.add('hidden');
  document.body.style.overflow = '';
}

function updateJudgeModal() {
  const scenario = JUDGE_SCENARIOS[state.judgeIndex];
  $('#judgeProgress').textContent = `SCENARIO ${state.judgeIndex + 1} OF ${JUDGE_SCENARIOS.length}`;
  $('#judgeNumber').textContent = scenario.number;
  $('#judgeFeature').textContent = scenario.feature;
  $('#judgeTitle').textContent = scenario.title;
  $('#judgeDescription').textContent = scenario.description;
  $('#judgeAmount').textContent = scenario.amount;
  $('#judgeResult').className = 'judge-result';
  $('#judgeResult').innerHTML = '<span>Ready to run through the canonical engine</span>';
  $('#judgeNext').textContent = 'Run Scenario';
}

function renderJudgeResult(result, customText) {
  const panel = $('#judgeResult');
  panel.className = `judge-result ${decisionClass(result.decision)}`;
  panel.innerHTML = `<span>${escapeHTML(customText ?? `${displayDecision(result.decision)} · ${result.reason}`)}</span>`;
}

function runJudgeScenario() {
  const scenario = JUDGE_SCENARIOS[state.judgeIndex];
  if ($('#judgeNext').textContent === 'Next Scenario' || $('#judgeNext').textContent === 'Open Forensic Proof') {
    if (state.judgeIndex < JUDGE_SCENARIOS.length - 1) {
      state.judgeIndex += 1;
      updateJudgeModal();
    } else {
      closeJudgeMode();
      switchView('forensics');
      $('#control-centre').scrollIntoView({ behavior: 'smooth' });
    }
    return;
  }

  let result;
  if (scenario.action === 'safe') result = runSafe();
  if (scenario.action === 'overspend') result = runOverspend();
  if (scenario.action === 'evasion') result = runEvasion();
  if (scenario.action === 'risk') {
    result = injectRisk();
    renderJudgeResult(result, `${result.riskState} · Calculated risk ${result.riskScore}/100. ${state.engine.getSnapshot().risk.response}`);
  }
  if (scenario.action === 'freezePending') {
    result = startPending(8);
    renderJudgeResult(result);
    if (result?.decision === 'HOLD') {
      state.judgeActionTimer = setTimeout(() => {
        const invalidated = freezeAgent();
        renderJudgeResult({ ...invalidated, decision: invalidated.decision }, `${displayDecision(invalidated.decision)} · ${invalidated.reason}`);
      }, 1_400);
    }
  }
  if (scenario.action === 'forensics') {
    const ledger = state.engine.getLedger();
    state.replayIndex = Math.max(0, ledger.length - 1);
    renderForensics();
    const fundsMoved = ledger
      .filter(event => ['BLOCK', 'INVALIDATE', 'FREEZE'].includes(event.decision))
      .reduce((sum, event) => sum + event.fundsMoved, 0);
    result = ledger.at(-1) ?? { decision: 'BLOCK', reason: 'No evidence recorded.' };
    renderJudgeResult(result, `EVIDENCE RECORDED · ${ledger.length} engine events · prohibited funds moved ${formatINR(fundsMoved)}.`);
  }
  if (!['risk', 'freezePending', 'forensics'].includes(scenario.action)) renderJudgeResult(result);
  $('#judgeNext').textContent = state.judgeIndex === JUDGE_SCENARIOS.length - 1 ? 'Open Forensic Proof' : 'Next Scenario';
}

function previousJudgeScenario() {
  if (state.judgeIndex > 0) {
    state.judgeIndex -= 1;
    updateJudgeModal();
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
  $('#resetEnvironment').addEventListener('click', resetEnvironment);
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
  $('#launchJudgeMode').addEventListener('click', openJudgeMode);
  $('#launchJudgeModeBottom').addEventListener('click', openJudgeMode);
  $('#closeJudgeMode').addEventListener('click', closeJudgeMode);
  $('#judgeNext').addEventListener('click', runJudgeScenario);
  $('#judgePrev').addEventListener('click', previousJudgeScenario);
  $('#judgeReset').addEventListener('click', () => { resetEnvironment(); openJudgeMode(); });
  $('.judge-backdrop').addEventListener('click', closeJudgeMode);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#judgeModal').classList.contains('hidden')) closeJudgeMode();
  });
}

document.addEventListener('DOMContentLoaded', initInteractions);
