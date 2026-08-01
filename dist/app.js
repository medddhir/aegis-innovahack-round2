const INITIAL_EVENTS = [
  { time: '09:42:16', title: 'Authorised cloud payment', detail: '₹850 → CloudGrid · Capsule CAP-8A72', status: 'APPROVED', kind: 'approved' },
  { time: '09:42:24', title: 'Unknown recipient attempt', detail: '₹6,000 → 0xF4…91B · allowlist failed', status: 'BLOCKED', kind: 'blocked' },
  { time: '09:42:31', title: 'Policy engine heartbeat', detail: 'PROCUREMENT-V4 · all controls operational', status: 'ACTIVE', kind: 'system' },
];

const FORENSIC_STEPS = [
  { time: '09:42:16', title: 'Valid payment approved', detail: '₹850 → CloudGrid · task and recipient matched.' },
  { time: '09:42:24', title: 'Unknown recipient blocked', detail: 'Recipient was not present in CAP-8A72 allowlist.' },
  { time: '09:42:29', title: 'Split-payment sequence started', detail: 'Four requests arrived below the single-payment cap.' },
  { time: '09:42:34', title: 'Evasion Shield triggered', detail: 'Requests clustered into ₹7,996 attempted value.' },
  { time: '09:42:35', title: 'Agent restricted automatically', detail: 'Risk Governor tightened limits and required approval.' },
  { time: '09:42:41', title: 'Owner activated kill switch', detail: 'Pending authority revoked; policy epoch incremented.' },
  { time: '09:42:41', title: 'Pending intent invalidated', detail: 'Settlement revalidation failed. Funds moved: ₹0.' },
];

const JUDGE_SCENARIOS = [
  {
    number: '01', feature: 'NORMAL OPERATION', title: 'Authorised payment',
    description: 'The agent requests ₹1,200 to an approved cloud provider. Aegis verifies the task, recipient, amount and active policy before approval.',
    amount: '₹1,200 → CloudGrid', result: 'APPROVED · Task, recipient and amount are within policy.', resultClass: 'approved', action: 'safe'
  },
  {
    number: '02', feature: 'INDEPENDENT ENFORCEMENT', title: 'Overspending attempt',
    description: 'The agent requests ₹8,500 even though its per-transaction cap is ₹2,500. The policy lives outside the agent, so the request cannot bypass it.',
    amount: '₹8,500 → CloudGrid', result: 'BLOCKED · Per-transaction cap exceeded by ₹6,000.', resultClass: 'blocked', action: 'overspend'
  },
  {
    number: '03', feature: 'EVASION SHIELD', title: 'Threshold splitting attack',
    description: 'The compromised agent divides one large payment into four requests of ₹1,999. Aegis groups them as one coordinated sequence instead of approving them independently.',
    amount: '4 × ₹1,999 → CloudGrid', result: 'BLOCKED · ₹7,996 coordinated evasion pattern detected.', resultClass: 'blocked', action: 'evasion'
  },
  {
    number: '04', feature: 'ADAPTIVE RISK GOVERNOR', title: 'Permissions tighten automatically',
    description: 'Repeated violations raise the behavioural risk score. Aegis moves the agent from Normal to Restricted and requires human approval for future requests.',
    amount: 'NORMAL → RESTRICTED', result: 'AUTOMATIC RESPONSE · New recipients disabled and limits reduced.', resultClass: 'pending', action: 'risk'
  },
  {
    number: '05', feature: 'IN-FLIGHT REVOCATION', title: 'Freeze before settlement',
    description: 'A valid transaction enters a short settlement queue. The owner freezes the agent before final revalidation, invalidating the pending intent before any funds move.',
    amount: '₹1,500 → ComputeHub', result: 'INVALIDATED · Agent frozen before final settlement.', resultClass: 'blocked', action: 'freezePending'
  },
  {
    number: '06', feature: 'FORENSIC PROOF LEDGER', title: 'Replay the complete attack',
    description: 'Aegis preserves who requested each payment, which policy was evaluated, every signal detected and why the final decision was made.',
    amount: 'POLICY PROOF · AGS-7FD2', result: 'VERIFIED · Funds moved during attack sequence: ₹0.', resultClass: 'approved', action: 'forensics'
  }
];

const state = {
  agentState: 'NORMAL',
  risk: 12,
  budgetTotal: 10000,
  spent: 3200,
  protected: 19996,
  approved: 7,
  blocked: 3,
  pending: 0,
  policy: 'PROCUREMENT-V4',
  events: [...INITIAL_EVENTS],
  countdownId: null,
  pendingSeconds: 0,
  replayIndex: 0,
  replayTimer: null,
  judgeIndex: 0,
  capsule: { task: 'Purchase cloud-compute capacity', budget: 10000, cap: 2500, vendors: ['CloudGrid','ComputeHub'] }
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const formatINR = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
const nowTime = () => new Date().toLocaleTimeString('en-GB', { hour12: false });

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

function addEvent(title, detail, status, kind = 'system') {
  state.events.unshift({ time: nowTime(), title, detail, status, kind });
  if (state.events.length > 18) state.events.pop();
  renderEvents();
  renderForensics();
}

function renderEvents() {
  const stream = $('#eventStream');
  stream.innerHTML = state.events.map(event => `
    <div class="event-item">
      <span class="event-time">${event.time}</span>
      <div class="event-main"><strong>${event.title}</strong><small>${event.detail}</small></div>
      <span class="event-status ${event.kind}">${event.status}</span>
    </div>`).join('');
}

function setAgentState(nextState, riskValue = state.risk) {
  state.agentState = nextState;
  state.risk = Math.max(0, Math.min(100, riskValue));
  const cls = `state-${nextState.toLowerCase()}`;
  const topState = $('#topAgentState');
  topState.textContent = nextState;
  topState.className = cls;
  $('#stateValue').textContent = nextState;
  $('#stateValue').className = cls;
  $('#riskValue').textContent = state.risk;
  $('#riskBar').style.width = `${state.risk}%`;
  $('#riskBar').style.background = state.risk >= 80 ? 'var(--red)' : state.risk >= 55 ? 'var(--orange)' : state.risk >= 30 ? 'var(--amber)' : 'var(--green)';
  $('#stateOrb span').style.borderColor = state.risk >= 80 ? 'rgba(255,79,102,.45)' : state.risk >= 55 ? 'rgba(255,122,69,.45)' : state.risk >= 30 ? 'rgba(255,184,77,.45)' : 'rgba(66,211,146,.28)';
  updateRiskLadder();
}

function renderMetrics() {
  $('#budgetRemaining').textContent = formatINR(Math.max(0, state.budgetTotal - state.spent));
  $('#budgetBar').style.width = `${Math.min(100, (state.spent / state.budgetTotal) * 100)}%`;
  $('#protectedValue').textContent = formatINR(state.protected);
  $('#approvedCount').textContent = state.approved;
  $('#blockedCount').textContent = state.blocked;
  $('#pendingCount').textContent = state.pending;
}

function updateRiskLadder() {
  const order = ['NORMAL','CAUTION','RESTRICTED','QUARANTINED','FROZEN'];
  const index = order.indexOf(state.agentState);
  $$('.risk-step').forEach((step, i) => step.classList.toggle('active', i === index));
}

function runSafe() {
  if (state.agentState === 'FROZEN') {
    blockFrozenAttempt('₹1,200 → CloudGrid');
    return;
  }
  state.spent += 1200;
  state.approved += 1;
  addEvent('Authorised payment approved', '₹1,200 → CloudGrid · all policy checks passed', 'APPROVED', 'approved');
  renderMetrics();
  toast('Payment approved by Aegis');
}

function runOverspend() {
  state.blocked += 1;
  state.protected += 8500;
  const nextRisk = Math.max(state.risk, 34);
  setAgentState(nextRisk >= 30 ? 'CAUTION' : state.agentState, nextRisk);
  addEvent('Overspending attempt blocked', '₹8,500 → CloudGrid · ₹2,500 cap exceeded', 'BLOCKED', 'blocked');
  renderMetrics();
  toast('Aegis blocked the oversized payment');
  showAttackResult('BLOCKED', 'Per-transaction cap exceeded by ₹6,000.', false);
}

function runUnknown() {
  state.blocked += 1;
  state.protected += 2000;
  setAgentState(state.risk >= 55 ? 'RESTRICTED' : 'CAUTION', Math.max(state.risk, 42));
  addEvent('Unknown recipient blocked', '₹2,000 → 0xF4…91B · counterparty not allowlisted', 'BLOCKED', 'blocked');
  renderMetrics();
  toast('Counterparty rejected by allowlist');
  showAttackResult('BLOCKED', 'Recipient not present in active Budget Capsule.', false);
}

function runEvasion() {
  state.blocked += 4;
  state.protected += 7996;
  setAgentState('RESTRICTED', Math.max(state.risk, 76));
  addEvent('Evasion Shield triggered', '4 × ₹1,999 clustered into ₹7,996 coordinated attempt', 'BLOCKED', 'blocked');
  addEvent('Risk Governor tightened permissions', 'New recipients disabled · human approval required', 'RESTRICTED', 'system');
  renderMetrics();
  showAttackResult('BLOCKED', 'Coordinated limit-evasion pattern detected.', true);
  updateRiskSignals(true);
  toast('Evasion Shield detected threshold splitting');
}

function showAttackResult(status, reason, cluster = false) {
  $('#attackStatus').classList.add('hidden');
  $('#attackCluster').classList.toggle('hidden', !cluster);
  const result = $('#enforcementResult');
  result.classList.remove('hidden');
  $('strong', result).textContent = status;
  $('p', result).textContent = reason;
}

function startPending(seconds = 10) {
  clearPendingTimer();
  if (state.agentState === 'FROZEN') {
    blockFrozenAttempt('₹1,500 → ComputeHub');
    return;
  }
  state.pending = 1;
  state.pendingSeconds = seconds;
  renderMetrics();
  $('#pendingBanner').classList.remove('hidden');
  $('#countdown').textContent = seconds;
  $('#pendingTrack').style.width = '0%';
  addEvent('Transaction intent authorised', '₹1,500 → ComputeHub · awaiting final revalidation', 'PENDING', 'pending');
  let elapsed = 0;
  requestAnimationFrame(() => $('#pendingTrack').style.width = '5%');
  state.countdownId = setInterval(() => {
    elapsed += 1;
    state.pendingSeconds -= 1;
    $('#countdown').textContent = Math.max(0, state.pendingSeconds);
    $('#pendingTrack').style.width = `${Math.min(100, (elapsed / seconds) * 100)}%`;
    if (state.pendingSeconds <= 0) settlePending();
  }, 1000);
  toast('Valid intent entered the settlement queue');
}

function settlePending() {
  clearPendingTimer(false);
  if (state.agentState === 'FROZEN') return;
  state.pending = 0;
  state.spent += 1500;
  state.approved += 1;
  $('#pendingBanner').classList.add('hidden');
  addEvent('Pending intent settled', '₹1,500 → ComputeHub · final policy revalidation passed', 'APPROVED', 'approved');
  renderMetrics();
  toast('Transaction settled after final revalidation');
}

function clearPendingTimer(hide = true) {
  if (state.countdownId) clearInterval(state.countdownId);
  state.countdownId = null;
  if (hide) $('#pendingBanner').classList.add('hidden');
}

function freezeAgent() {
  const hadPending = state.pending > 0;
  clearPendingTimer();
  state.pending = 0;
  setAgentState('FROZEN', 100);
  addEvent('Owner activated kill switch', 'Agent authority revoked · policy epoch incremented', 'FROZEN', 'blocked');
  if (hadPending) {
    state.blocked += 1;
    state.protected += 1500;
    addEvent('Pending intent invalidated', '₹1,500 → ComputeHub · no funds moved', 'INVALIDATED', 'blocked');
  }
  renderMetrics();
  toast(hadPending ? 'Agent frozen — pending payment invalidated' : 'Agent financial authority frozen');
}

function blockFrozenAttempt(detail) {
  state.blocked += 1;
  addEvent('Frozen agent request rejected', `${detail} · financial authority revoked`, 'BLOCKED', 'blocked');
  renderMetrics();
  toast('Request rejected: agent is frozen');
}

function updateRiskSignals(attacked = false) {
  const rows = $$('#signalList > div');
  if (!attacked) {
    const values = ['NORMAL','0','0','NOT DETECTED','0'];
    rows.forEach((row, i) => { const b = $('b', row); b.textContent = values[i]; b.className = 'good'; });
    $('#automaticResponse p').textContent = 'No restrictions required. Agent operates within policy.';
    return;
  }
  const values = [
    ['CRITICAL','bad'],['4','bad'],['6','bad'],['DETECTED','bad'],['1','warn']
  ];
  rows.forEach((row, i) => { const b = $('b', row); b.textContent = values[i][0]; b.className = values[i][1]; });
  $('#automaticResponse p').innerHTML = 'Per-transaction limit reduced by 60% · new recipients disabled · settlement delay raised · human approval required.';
}

function injectRisk() {
  setAgentState('RESTRICTED', 78);
  updateRiskSignals(true);
  addEvent('Suspicious behaviour injected', 'Velocity, retry and recipient anomalies detected', 'CRITICAL', 'blocked');
  addEvent('Adaptive restrictions applied', 'Limits reduced · approval threshold activated', 'RESTRICTED', 'system');
  toast('Risk Governor tightened permissions');
}

function activateCapsule() {
  const budget = Number($('#capsuleBudget').value) || 10000;
  const cap = Number($('#capsuleCap').value) || 2500;
  const task = $('#capsuleTask').value.trim() || 'Purchase cloud-compute capacity';
  const vendors = $$('.chip.selected').map(chip => chip.textContent);
  state.capsule = { task, budget, cap, vendors };
  state.budgetTotal = budget;
  state.spent = 0;
  $('#capsuleTitle').textContent = task.replace(/^Purchase /i, '').replace(/\w/g, c => c.toUpperCase());
  $('#capsuleSummary').textContent = `Procurement-07 may spend up to ${formatINR(budget)} for “${task}”, only through ${vendors.join(' and ') || 'approved counterparties'}, until the configured expiry.`;
  $('#capsuleBudgetDisplay').textContent = formatINR(budget);
  $('#capsuleCapDisplay').textContent = formatINR(cap);
  renderMetrics();
  addEvent('Budget Capsule activated', `${formatINR(budget)} · ${vendors.length} approved counterparties`, 'ACTIVE', 'system');
  toast('Task-Bound Budget Capsule activated');
}

function runTwin() {
  const v1 = $('#v1Result');
  const v2 = $('#v2Result');
  v1.textContent = 'Testing…';
  v2.textContent = 'Testing…';
  $('#twinSummary').classList.add('hidden');
  setTimeout(() => { v1.textContent = '4 of 6 attacks succeeded'; v1.style.color = 'var(--red)'; }, 650);
  setTimeout(() => { v2.textContent = '0 of 6 attacks succeeded'; v2.style.color = 'var(--green)'; }, 1050);
  setTimeout(() => {
    $('#twinSummary').classList.remove('hidden');
    addEvent('Policy Digital Twin completed', 'V2 blocked all six simulated attack scenarios', 'VERIFIED', 'approved');
    toast('Policy V2 passed the attack simulation');
  }, 1350);
}

function runRapid() {
  state.blocked += 8;
  state.protected += 6400;
  setAgentState('RESTRICTED', 83);
  addEvent('Rapid-fire transaction burst blocked', '8 requests in 4 seconds · velocity threshold exceeded', 'BLOCKED', 'blocked');
  renderMetrics();
  showAttackResult('BLOCKED', 'Abnormal transaction velocity detected.', false);
  toast('Rapid-fire attack contained');
}

function renderForensics() {
  const timeline = $('#forensicTimeline');
  timeline.innerHTML = FORENSIC_STEPS.map((step, i) => `
    <div class="timeline-item ${i === state.replayIndex ? 'active' : ''}" data-replay-index="${i}">
      <span class="timeline-time">${step.time}</span>
      <div class="timeline-point"><span></span></div>
      <div class="timeline-content"><strong>${step.title}</strong><small>${step.detail}</small></div>
    </div>`).join('');
  renderProofTerminal();
}

function renderProofTerminal() {
  const step = FORENSIC_STEPS[state.replayIndex];
  const terminal = $('#proofTerminal');
  const decision = state.replayIndex < 1 ? 'APPROVED' : state.replayIndex < 5 ? 'BLOCKED' : 'REVOKED';
  terminal.textContent = `$ aegis verify --event ${String(state.replayIndex + 1).padStart(2,'0')}\n\nAGENT          Procurement-07\nOWNER          TurboPay Technologies Pvt. Ltd.\nPOLICY         PROCUREMENT-V4\nPOLICY HASH    AGS-7FD2-91C8\nEVENT          ${step.title}\nTIMESTAMP      ${step.time}\nDECISION       ${decision}\nRULE           ${state.replayIndex === 3 ? 'CUMULATIVE_WINDOW_LIMIT' : state.replayIndex === 6 ? 'POLICY_EPOCH_REVOKED' : 'TASK_AND_RECIPIENT_POLICY'}\nRISK STATE     ${state.replayIndex >= 4 ? 'CRITICAL' : 'NORMAL'}\nFUNDS MOVED    ${state.replayIndex === 0 ? '₹850 (simulated)' : '₹0'}\n\n✓ Decision trace verified\n✓ Policy version verified\n✓ Owner action verified`;
}

function stepReplay(delta) {
  state.replayIndex = Math.max(0, Math.min(FORENSIC_STEPS.length - 1, state.replayIndex + delta));
  renderForensics();
}

function playReplay() {
  clearInterval(state.replayTimer);
  state.replayIndex = 0;
  renderForensics();
  $('#replayPlay').textContent = 'Playing…';
  state.replayTimer = setInterval(() => {
    if (state.replayIndex >= FORENSIC_STEPS.length - 1) {
      clearInterval(state.replayTimer);
      $('#replayPlay').textContent = 'Play Replay';
      return;
    }
    state.replayIndex += 1;
    renderForensics();
  }, 850);
}

function switchView(view) {
  $$('.nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.view === view));
  $$('.view-panel').forEach(panel => panel.classList.toggle('active', panel.dataset.panel === view));
  const labels = { overview: 'OVERVIEW', capsules: 'BUDGET CAPSULES', risk: 'RISK GOVERNOR', twin: 'POLICY TWIN', attack: 'ATTACK LAB', forensics: 'FORENSICS' };
  const titles = { overview: 'Autonomous Agent Command Centre', capsules: 'Purpose-Locked Financial Authority', risk: 'Behaviour-Adaptive Financial Defence', twin: 'Pre-Deployment Policy Simulation', attack: 'Adversarial Transaction Testing', forensics: 'Evidence-Backed Incident Replay' };
  $('#currentViewLabel').textContent = labels[view];
  $('#controlTitle').textContent = titles[view];
}

function resetEnvironment() {
  clearPendingTimer();
  clearInterval(state.replayTimer);
  Object.assign(state, {
    agentState: 'NORMAL', risk: 12, budgetTotal: 10000, spent: 3200, protected: 19996,
    approved: 7, blocked: 3, pending: 0, policy: 'PROCUREMENT-V4', events: [...INITIAL_EVENTS], replayIndex: 0
  });
  setAgentState('NORMAL', 12);
  renderMetrics();
  renderEvents();
  updateRiskSignals(false);
  $('#pendingBanner').classList.add('hidden');
  $('#attackStatus').classList.remove('hidden');
  $('#attackCluster').classList.add('hidden');
  $('#enforcementResult').classList.add('hidden');
  $('#v1Result').textContent = 'Not tested'; $('#v1Result').style.color = '';
  $('#v2Result').textContent = 'Not tested'; $('#v2Result').style.color = '';
  $('#twinSummary').classList.add('hidden');
  renderForensics();
  switchView('overview');
  toast('Demo environment restored');
}

function executeScenario(name) {
  switch (name) {
    case 'safe': runSafe(); break;
    case 'overspend': runOverspend(); break;
    case 'unknown': runUnknown(); break;
    case 'evasion': runEvasion(); break;
    case 'rapid': runRapid(); break;
    case 'pending': startPending(); break;
  }
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
  const result = $('#judgeResult');
  result.className = 'judge-result';
  result.innerHTML = '<span>Ready to run</span>';
  $('#judgeNext').textContent = 'Run Scenario';
}

function runJudgeScenario() {
  const scenario = JUDGE_SCENARIOS[state.judgeIndex];
  const result = $('#judgeResult');
  if ($('#judgeNext').textContent === 'Next Scenario') {
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

  if (scenario.action === 'safe') runSafe();
  if (scenario.action === 'overspend') runOverspend();
  if (scenario.action === 'evasion') runEvasion();
  if (scenario.action === 'risk') injectRisk();
  if (scenario.action === 'freezePending') {
    startPending(8);
    setTimeout(() => freezeAgent(), 1400);
  }
  if (scenario.action === 'forensics') {
    state.replayIndex = FORENSIC_STEPS.length - 1;
    renderForensics();
  }
  result.className = `judge-result ${scenario.resultClass}`;
  result.innerHTML = `<span>${scenario.result}</span>`;
  $('#judgeNext').textContent = state.judgeIndex === JUDGE_SCENARIOS.length - 1 ? 'Open Forensic Proof' : 'Next Scenario';
}

function previousJudgeScenario() {
  if (state.judgeIndex > 0) {
    state.judgeIndex -= 1;
    updateJudgeModal();
  }
}

function initInteractions() {
  renderEvents();
  renderMetrics();
  renderForensics();
  updateRiskLadder();

  $$('.nav-item').forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));
  $$('.scenario-button, .attack-option').forEach(btn => btn.addEventListener('click', () => executeScenario(btn.dataset.scenario)));
  $$('[data-freeze-button]').forEach(btn => btn.addEventListener('click', freezeAgent));
  $$('.chip').forEach(chip => chip.addEventListener('click', () => chip.classList.toggle('selected')));

  $('#clearEvents').addEventListener('click', () => { state.events = []; renderEvents(); });
  $('#resetEnvironment').addEventListener('click', resetEnvironment);
  $('#activateCapsule').addEventListener('click', activateCapsule);
  $('#injectRisk').addEventListener('click', injectRisk);
  $('#runTwin').addEventListener('click', runTwin);
  $('#replayPrev').addEventListener('click', () => stepReplay(-1));
  $('#replayNext').addEventListener('click', () => stepReplay(1));
  $('#replayPlay').addEventListener('click', playReplay);

  $('#launchJudgeMode').addEventListener('click', openJudgeMode);
  $('#launchJudgeModeBottom').addEventListener('click', openJudgeMode);
  $('#closeJudgeMode').addEventListener('click', closeJudgeMode);
  $('#judgeNext').addEventListener('click', runJudgeScenario);
  $('#judgePrev').addEventListener('click', previousJudgeScenario);
  $('#judgeReset').addEventListener('click', () => { resetEnvironment(); state.judgeIndex = 0; updateJudgeModal(); });
  $('.judge-backdrop').addEventListener('click', closeJudgeMode);
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#judgeModal').classList.contains('hidden')) closeJudgeMode(); });
}

document.addEventListener('DOMContentLoaded', initInteractions);
