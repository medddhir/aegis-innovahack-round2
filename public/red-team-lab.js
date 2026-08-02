import { createCoreVisualState } from './visual-state.js';
import { RED_TEAM_PRESETS, RedTeamSession, RULES, escapeRedTeamText, formatPaise } from './red-team-session.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const formatINR = value => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: Number(value) % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(Number(value));

const PIPELINE = Object.freeze([
  ['INTENT', []],
  ['IDENTITY', [RULES.AGENT_EXISTS, RULES.AGENT_NOT_FROZEN, RULES.POLICY_VERSION_CURRENT]],
  ['TASK', [RULES.TASK_MATCHES_CAPSULE, RULES.CAPSULE_NOT_EXPIRED, RULES.CATEGORY_MATCHES]],
  ['RECIPIENT', [RULES.RECIPIENT_ALLOWLISTED]],
  ['LIMITS', [RULES.AMOUNT_POSITIVE, RULES.PER_TRANSACTION_LIMIT]],
  ['BUDGET', [RULES.CUMULATIVE_BUDGET]],
  ['NONCE', [RULES.NONCE_UNIQUE]],
  ['BEHAVIOUR RISK', [RULES.EVASION_SHIELD, RULES.RISK_GOVERNOR]],
  ['FINAL DECISION', [RULES.FINAL_SETTLEMENT_REVALIDATION]],
]);

function resultTone(decision) {
  if (decision === 'APPROVE') return 'approved';
  if (decision === 'HOLD' || decision === 'REQUIRE_APPROVAL') return 'pending';
  if (decision === 'INVALIDATE') return 'invalidated';
  if (decision === 'FREEZE') return 'frozen';
  return 'blocked';
}

function resultTitle(decision) {
  return ({
    APPROVE: 'POLICY-COMPLIANT AUTONOMY PERMITTED',
    HOLD: 'PENDING SETTLEMENT',
    REQUIRE_APPROVAL: 'OWNER APPROVAL REQUIRED',
    BLOCK: 'ATTEMPT BLOCKED',
    INVALIDATE: 'FINANCIAL AUTHORITY REVOKED',
    FREEZE: 'FINANCIAL AUTHORITY REVOKED',
  }[decision] ?? 'ENGINE RESULT');
}

function terminalText(outcome) {
  const result = outcome.primary;
  if (!result) return '$ aegis red-team --await-intent\n\nNo custom attempt has been submitted.';
  const rules = (result.rulesEvaluated ?? []).map((rule, index) => `${String(index + 1).padStart(2, '0')}  ${rule.passed ? 'PASS' : 'FAIL'}  ${rule.rule}\n    ${rule.reason}`).join('\n');
  const signals = Object.entries(result.ledgerEvent?.riskSignals ?? outcome.ledgerEvents.at(-1)?.riskSignals ?? {}).map(([name, value]) => `${name}=${value}`).join(' · ');
  return `$ aegis red-team --intent ${result.intent?.id ?? 'OWNER-ACTION'}\n\nDECISION       ${outcome.decision}\nDECISIVE RULE  ${outcome.ruleChecked}\nPOLICY VERSION ${outcome.activePolicyVersion ?? 'N/A'}\nRISK STATE     ${outcome.riskState} (${outcome.riskScore}/100)\nFUNDS MOVED    ${formatINR(outcome.fundsMoved)} · SIMULATED\nRISK SIGNALS   ${signals || 'NONE'}\n\n${rules || 'No transaction rules were required for this owner action.'}`;
}

export function initRedTeamLab({ getActivePolicy, beforeOpen = () => {}, returnToJudgeMode = () => {} } = {}) {
  const modal = $('#redTeamModal');
  if (!modal) return null;
  let session = new RedTeamSession({ basePolicy: getActivePolicy?.() });
  let previousFocus = null;
  let countdownId = null;
  let countdownSeconds = 0;
  let running = false;
  let selectedPreset = 'compliant';
  let lastRenderedEventCount = 0;

  function clearCountdown() {
    if (countdownId) window.clearInterval(countdownId);
    countdownId = null;
    countdownSeconds = 0;
  }

  function setBackgroundInert(inert) {
    $$('body > header, body > main, body > footer, #judgeModal').forEach(element => {
      element.inert = inert;
      if (inert) element.setAttribute('aria-hidden', 'true');
      else element.removeAttribute('aria-hidden');
    });
  }

  function currentPolicy() {
    return session.engine.getSnapshot().policy;
  }

  function setRecipientOptions() {
    const policy = currentPolicy();
    const select = $('#redRecipient');
    const previous = select.value;
    select.replaceChildren(...policy.approvedRecipients.map(recipient => {
      const option = document.createElement('option');
      option.value = recipient;
      option.textContent = `${recipient} · approved`;
      return option;
    }));
    const custom = document.createElement('option');
    custom.value = '__CUSTOM__';
    custom.textContent = 'Custom unapproved recipient';
    select.append(custom);
    select.value = [...select.options].some(option => option.value === previous) ? previous : policy.approvedRecipients[0];
    $('#redCustomRecipientField').classList.toggle('hidden', select.value !== '__CUSTOM__');
    const taskSelect = $('#redTaskMode');
    taskSelect.options[0].textContent = `${policy.task} · authorised`;
  }

  function fillPolicyForm() {
    const policy = currentPolicy();
    $('#redPolicyAgent').value = policy.authorisedAgentId;
    $('#redPolicyTask').value = policy.task;
    $('#redPolicyTaskId').value = policy.taskId;
    $('#redPolicyCap').value = policy.perTransactionCap.toFixed(2);
    $('#redPolicyDaily').value = policy.dailyCumulativeCap.toFixed(2);
    $('#redPolicyTotal').value = policy.totalTaskBudget.toFixed(2);
    $('#redPolicyRecipients').value = policy.approvedRecipients.join(', ');
    $('#redPolicyExpiry').value = new Date(policy.expiresAt).toISOString().slice(0, 16);
    $('#redPolicyDelay').value = String(policy.settlementDelayMs / 1_000);
    $('#redPolicyThreshold').value = String(policy.violationThreshold);
    updatePolicyReview();
  }

  function updatePolicyReview() {
    const recipients = $('#redPolicyRecipients').value || 'No recipients';
    $('#redPolicyReview').textContent = `${$('#redPolicyAgent').value || 'Agent'} may request up to ${formatINR(Number($('#redPolicyCap').value || 0))} per transaction for “${$('#redPolicyTask').value || 'Unnamed task'}”, with ${recipients}. Activation is verified by the policy owner.`;
  }

  function showPolicyStep(step) {
    $$('[data-red-policy-step]').forEach(button => button.classList.toggle('active', Number(button.dataset.redPolicyStep) === step));
    $$('[data-red-policy-panel]').forEach(panel => panel.classList.toggle('hidden', Number(panel.dataset.redPolicyPanel) !== step));
    if (step === 5) updatePolicyReview();
  }

  function applyPreset(name, { focus = false } = {}) {
    const preset = RED_TEAM_PRESETS[name];
    if (!preset) return;
    selectedPreset = name;
    $$('[data-red-preset]').forEach(button => button.setAttribute('aria-selected', String(button.dataset.redPreset === name)));
    $('#redAmount').value = preset.amount;
    $('#redRequestCount').value = String(preset.requestCount);
    $('#redInterval').value = String(preset.intervalSeconds);
    $('#redNonceMode').value = preset.nonceMode;
    $('#redVersionMode').value = preset.versionMode;
    $('#redTaskMode').value = preset.taskMode;
    $('#redSettlementMode').value = preset.settlementMode;
    $('#redAgentMode').value = preset.agentMode;
    $('#redAttemptType').value = preset.attemptType;
    if (preset.recipientMode === 'custom') {
      $('#redRecipient').value = '__CUSTOM__';
      $('#redCustomRecipient').value = preset.customRecipient;
    } else {
      $('#redRecipient').value = currentPolicy().approvedRecipients[0];
    }
    $('#redCustomRecipientField').classList.toggle('hidden', preset.recipientMode !== 'custom');
    $('#redTeamError').textContent = '';
    $('#redAmount').removeAttribute('aria-invalid');
    if (focus) $('#redAmount').focus();
  }

  function readAttempt() {
    const custom = $('#redRecipient').value === '__CUSTOM__';
    return {
      amount: $('#redAmount').value,
      recipientMode: custom ? 'custom' : 'approved',
      recipient: custom ? undefined : $('#redRecipient').value,
      customRecipient: $('#redCustomRecipient').value,
      taskMode: $('#redTaskMode').value,
      requestCount: $('#redRequestCount').value,
      intervalSeconds: $('#redInterval').value,
      nonceMode: $('#redNonceMode').value,
      versionMode: $('#redVersionMode').value,
      settlementMode: $('#redSettlementMode').value,
      agentMode: $('#redAgentMode').value,
      attemptType: $('#redAttemptType').value,
      presetLabel: RED_TEAM_PRESETS[selectedPreset]?.label ?? 'Custom Attempt',
    };
  }

  function renderPipeline(outcome = null, active = false) {
    const rules = outcome?.rulesEvaluated ?? [];
    $('#redTeamPipeline').innerHTML = PIPELINE.map(([label, names], index) => {
      const relevant = rules.filter(rule => names.includes(rule.rule));
      let status = 'idle';
      if (index === 0 && outcome) status = 'pass';
      if (active && index === 1) status = 'active';
      else if (relevant.length) status = relevant.some(rule => !rule.passed) ? 'fail' : 'pass';
      if (label === 'FINAL DECISION' && outcome) status = ['APPROVE'].includes(outcome.decision) ? 'pass' : ['HOLD', 'REQUIRE_APPROVAL'].includes(outcome.decision) ? 'active' : 'fail';
      return `<li class="${status}"><i>${status === 'pass' ? '✓' : status === 'fail' ? '■' : status === 'active' ? '→' : '○'}</i><b>${escapeRedTeamText(label)}</b></li>`;
    }).join('');
  }

  function renderCluster(outcome) {
    const cluster = $('#redTeamCluster');
    const coordinated = outcome.requestCount > 1;
    cluster.classList.toggle('hidden', !coordinated);
    if (!coordinated) { cluster.replaceChildren(); return; }
    const rows = document.createElement('div');
    for (let index = 0; index < outcome.requestCount; index += 1) {
      const item = document.createElement('i');
      item.textContent = formatINR(outcome.attempt.amount);
      rows.append(item);
    }
    const title = document.createElement('b');
    title.textContent = `COORDINATED ATTEMPT · ${formatPaise(outcome.combinedAmountPaise)}`;
    const detail = document.createElement('small');
    detail.textContent = `${outcome.requestCount} RELATED REQUESTS · ${outcome.windowSeconds}-SECOND WINDOW`;
    cluster.replaceChildren(rows, title, detail);
  }

  function renderFacts(outcome) {
    const policy = currentPolicy();
    const attempted = outcome.primary?.intent?.amount ?? outcome.attempt?.amount ?? 0;
    const excess = outcome.ruleChecked === RULES.PER_TRANSACTION_LIMIT ? Math.max(0, attempted - policy.perTransactionCap) : 0;
    const facts = [
      ['AMOUNT / BOUNDARY', `${formatINR(attempted)} / ${formatINR(policy.perTransactionCap)}`],
      ['RECIPIENT / TASK', `${outcome.primary?.intent?.recipient ?? outcome.attempt?.recipient ?? 'N/A'} / ${outcome.primary?.intent?.taskId ?? outcome.attempt?.taskId ?? 'N/A'}`],
      ['DECISIVE RULE', outcome.ruleChecked],
      ['FUNDS MOVED', `${formatINR(outcome.fundsMoved)} · SIMULATED`],
    ];
    if (excess > 0) facts[0][1] += ` · EXCESS ${formatINR(excess)}`;
    $('#redTeamFacts').innerHTML = facts.map(([label, value]) => `<div><small>${escapeRedTeamText(label)}</small><b>${escapeRedTeamText(value)}</b></div>`).join('');
  }

  function renderLedger() {
    const ledger = session.getLedger();
    $('#redLedgerCount').textContent = `${ledger.length} ${ledger.length === 1 ? 'EVENT' : 'EVENTS'}`;
    const host = $('#redTeamLedger');
    if (!ledger.length) {
      const empty = document.createElement('p');
      empty.textContent = 'No recorded custom attempts.';
      host.replaceChildren(empty);
      lastRenderedEventCount = 0;
      return;
    }
    const fragment = document.createDocumentFragment();
    for (const event of ledger.slice(-16)) {
      const row = document.createElement('article');
      row.className = `red-ledger-event ${resultTone(event.decision)}`;
      const time = document.createElement('span');
      time.textContent = new Date(event.timestamp).toISOString().slice(11, 19);
      const copy = document.createElement('div');
      const title = document.createElement('b');
      title.textContent = `${event.intent?.id ?? event.eventType} · ${event.ruleChecked}`;
      const detail = document.createElement('small');
      detail.textContent = event.intent ? `${formatINR(event.intent.amount)} → ${event.intent.recipient}` : event.reason;
      copy.append(title, detail);
      const decision = document.createElement('em');
      decision.textContent = event.finalSettlementStatus;
      row.append(time, copy, decision);
      fragment.append(row);
    }
    host.replaceChildren(fragment);
    if (ledger.length > lastRenderedEventCount && !reducedMotion()) host.lastElementChild?.classList.add('new');
    lastRenderedEventCount = ledger.length;
  }

  function renderSummary() {
    const summary = session.getSummary();
    $('#redSummaryAttempts').textContent = String(summary.attemptsSubmitted);
    $('#redSummaryApproved').textContent = String(summary.approved);
    $('#redSummaryBlocked').textContent = String(summary.blocked);
    $('#redSummaryInvalidated').textContent = String(summary.invalidated);
    $('#redSummarySettled').textContent = String(summary.settled);
    $('#redSummaryAttempted').textContent = formatPaise(summary.cumulativeAttemptedPaise);
    $('#redSummaryMoved').textContent = formatPaise(summary.cumulativeFundsMovedPaise);
    $('#redSummaryProtected').textContent = formatPaise(summary.protectedValuePaise);
    $('#redSummaryRisk').textContent = `${summary.finalRiskState} · V${summary.finalPolicyVersion}`;
    const snapshot = session.engine.getSnapshot();
    $('#redPolicyLabel').textContent = snapshot.policyLabel;
    $('#redRiskLabel').textContent = `${snapshot.risk.state} · ${snapshot.risk.score}/100`;
  }

  function renderOutcome(outcome) {
    if (!outcome) return;
    const tone = resultTone(outcome.decision);
    const scan = $('#redTeamScan');
    scan.dataset.analysis = tone;
    const visual = createCoreVisualState(outcome.primary ?? outcome, outcome.riskState);
    $$('.red-team-core [data-layer]').forEach(ring => ring.classList.toggle('fail', ring.dataset.layer === visual.failingLayer));
    $('#redWalletState').textContent = outcome.decision === 'APPROVE' ? 'SETTLED · SIMULATED' : outcome.decision === 'HOLD' ? 'OPEN · UNSETTLED' : outcome.decision === 'INVALIDATE' || outcome.decision === 'FREEZE' ? 'LOCKED · AUTHORITY REVOKED' : 'NOT REACHED';
    const result = $('#redTeamResult');
    result.className = `red-team-result ${tone}`;
    result.replaceChildren();
    const label = document.createElement('span');
    label.textContent = `CANONICAL ENGINE · ${outcome.decision}`;
    const title = document.createElement('h3');
    title.textContent = resultTitle(outcome.decision);
    const reason = document.createElement('p');
    reason.textContent = outcome.decision === 'INVALIDATE' ? `PENDING INTENT INVALIDATED. ${outcome.reason}` : outcome.reason;
    result.append(label, title, reason);
    renderFacts(outcome);
    renderPipeline(outcome);
    renderCluster(outcome);
    $('#redTeamTerminal').textContent = terminalText(outcome);
    renderLedger();
    renderSummary();
    $('#redTeamReplay').disabled = !session.lastAttempt;
    if (outcome.attempt?.agentMode === 'compromised' || ['INVALIDATE', 'FREEZE'].includes(outcome.decision)) {
      title.classList.remove('letter-glitch-event');
      void title.offsetWidth;
      if (!reducedMotion()) title.classList.add('letter-glitch-event');
    }
    if (outcome.decision === 'HOLD' && session.pending.size) startPendingCountdown(outcome);
    else setPrimaryMode('attempt');
  }

  function setPrimaryMode(mode) {
    const button = $('#redTeamSubmit');
    button.classList.toggle('owner-action', mode === 'freeze');
    button.textContent = mode === 'freeze' ? 'ACTIVATE KILL SWITCH' : mode === 'running' ? 'EVALUATING…' : 'ATTEMPT TRANSACTION';
    button.dataset.mode = mode;
    button.disabled = mode === 'running';
    $('#redTeamPending').classList.toggle('hidden', mode !== 'freeze');
  }

  function startPendingCountdown(outcome) {
    clearCountdown();
    countdownSeconds = Math.max(1, Math.ceil(outcome.settlementDelayMs / 1_000));
    $('#redTeamCountdown').textContent = String(countdownSeconds);
    setPrimaryMode('freeze');
    countdownId = window.setInterval(() => {
      countdownSeconds -= 1;
      $('#redTeamCountdown').textContent = String(Math.max(0, countdownSeconds));
      if (countdownSeconds > 0) return;
      clearCountdown();
      const settled = session.settlePending();
      if (settled) renderOutcome(settled);
    }, 1_000);
  }

  function showError(error) {
    const message = error instanceof Error ? error.message : String(error);
    $('#redTeamError').textContent = message;
    $('#redAmount').toggleAttribute('aria-invalid', /amount/i.test(message));
    setPrimaryMode('attempt');
  }

  function submitAttempt(event) {
    event?.preventDefault();
    if (running) return;
    if ($('#redTeamSubmit').dataset.mode === 'freeze') return activateKillSwitch();
    running = true;
    clearCountdown();
    $('#redTeamError').textContent = '';
    $('#redAmount').removeAttribute('aria-invalid');
    setPrimaryMode('running');
    $('#redTeamScan').dataset.analysis = 'running';
    renderPipeline(null, true);
    try {
      const outcome = session.attempt(readAttempt());
      window.setTimeout(() => {
        running = false;
        renderOutcome(outcome);
      }, reducedMotion() ? 0 : 140);
    } catch (error) {
      running = false;
      showError(error);
    }
  }

  function activateKillSwitch() {
    if (!session.pending.size) return;
    clearCountdown();
    const outcome = session.freezePending();
    renderOutcome(outcome);
    $('#redTeamShell').classList.remove('freeze-event');
    void $('#redTeamShell').offsetWidth;
    if (!reducedMotion()) $('#redTeamShell').classList.add('freeze-event');
  }

  function activatePolicy() {
    try {
      const expiry = `${$('#redPolicyExpiry').value}:00.000Z`;
      const result = session.activatePolicy({
        agentId: $('#redPolicyAgent').value,
        task: $('#redPolicyTask').value,
        taskId: $('#redPolicyTaskId').value,
        perTransactionCap: $('#redPolicyCap').value,
        dailyCumulativeCap: $('#redPolicyDaily').value,
        totalTaskBudget: $('#redPolicyTotal').value,
        approvedRecipients: $('#redPolicyRecipients').value.split(','),
        expiresAt: expiry,
        settlementDelaySeconds: $('#redPolicyDelay').value,
        violationThreshold: $('#redPolicyThreshold').value,
      });
      setRecipientOptions();
      fillPolicyForm();
      applyPreset('compliant');
      renderLedger();
      renderSummary();
      $('#redTeamResult').className = 'red-team-result approved';
      $('#redTeamResult').innerHTML = `<span>VERIFIED OWNER ACTION</span><h3>TEST POLICY ACTIVATED</h3><p>${escapeRedTeamText(result.reason)}</p>`;
      $('#redTeamTerminal').textContent = `$ aegis policy activate --owner verified\n\nPOLICY   ${session.engine.getSnapshot().policyLabel}\nTASK     ${session.engine.policy.taskId}\nAGENT    ${session.engine.policy.authorisedAgentId}\nDECISION ${result.decision}\nRULE     ${result.ruleChecked}`;
      $('#redPolicyPanel').open = false;
    } catch (error) {
      showError(error);
      $('#redPolicyPanel').open = true;
    }
  }

  function resetLab({ policy = getActivePolicy?.() } = {}) {
    clearCountdown();
    running = false;
    session = new RedTeamSession({ basePolicy: policy });
    lastRenderedEventCount = 0;
    setRecipientOptions();
    fillPolicyForm();
    applyPreset('compliant');
    showPolicyStep(1);
    $('#redTeamError').textContent = '';
    $('#redTeamScan').dataset.analysis = 'idle';
    $$('.red-team-core [data-layer]').forEach(ring => ring.classList.remove('fail'));
    $('#redWalletState').textContent = 'OPEN · SIMULATED';
    $('#redTeamCluster').classList.add('hidden');
    $('#redTeamResult').className = 'red-team-result';
    $('#redTeamResult').innerHTML = '<span>READY</span><h3>Try to break Aegis.</h3><p>Define an attempt. The canonical engine—not the selected preset—decides the outcome.</p>';
    $('#redTeamFacts').innerHTML = '';
    $('#redTeamTerminal').textContent = '$ aegis red-team --await-intent\n\nNo custom attempt has been submitted.';
    $('#redTeamReplay').disabled = true;
    renderPipeline();
    renderLedger();
    renderSummary();
    setPrimaryMode('attempt');
  }

  function replayLast() {
    if (running || !session.lastAttempt) return;
    clearCountdown();
    const outcome = session.replayLast();
    setRecipientOptions();
    renderOutcome(outcome);
  }

  function open() {
    previousFocus = document.activeElement;
    beforeOpen();
    resetLab();
    modal.classList.remove('hidden');
    document.body.classList.add('red-team-open');
    setBackgroundInert(true);
    $('#redTeamShell').focus({ preventScroll: true });
  }

  function close({ restoreFocus = true } = {}) {
    clearCountdown();
    modal.classList.add('hidden');
    document.body.classList.remove('red-team-open');
    setBackgroundInert(false);
    if (restoreFocus && previousFocus?.isConnected) previousFocus.focus();
  }

  function returnToJudge() {
    close({ restoreFocus: false });
    returnToJudgeMode();
  }

  function trapFocus(event) {
    if (modal.classList.contains('hidden') || event.key !== 'Tab') return;
    const focusable = $$('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])', $('#redTeamShell')).filter(element => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  $$('[data-open-red-team]').forEach(button => button.addEventListener('click', open));
  $$('[data-red-preset]').forEach(button => button.addEventListener('click', () => applyPreset(button.dataset.redPreset, { focus: true })));
  $$('[data-red-policy-step]').forEach(button => button.addEventListener('click', () => showPolicyStep(Number(button.dataset.redPolicyStep))));
  $$('#redPolicyPanel input, #redPolicyPanel textarea').forEach(input => input.addEventListener('input', updatePolicyReview));
  $('#redRecipient').addEventListener('change', setRecipientOptions);
  $('#redTeamForm').addEventListener('submit', submitAttempt);
  $('#redPolicyActivate').addEventListener('click', activatePolicy);
  $('#redTeamReset').addEventListener('click', () => resetLab());
  $('#redTeamReplay').addEventListener('click', replayLast);
  $('#redTeamReturnJudge').addEventListener('click', returnToJudge);
  $('#redTeamClose').addEventListener('click', close);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.classList.contains('hidden')) { event.preventDefault(); close(); }
    else trapFocus(event);
  });

  const captureMode = ['localhost', '127.0.0.1'].includes(window.location.hostname) ? new URLSearchParams(location.search).get('capture') : null;
  if (captureMode?.startsWith('red-')) window.setTimeout(() => {
    open();
    const presetForMode = ({ 'red-compliant': 'compliant', 'red-oversized': 'oversized', 'red-unknown': 'unknown', 'red-split': 'splitting', 'red-duplicate': 'duplicate', 'red-pending': 'pending', 'red-kill': 'pending' })[captureMode];
    if (presetForMode) applyPreset(presetForMode);
    if (presetForMode) submitAttempt();
    if (captureMode === 'red-kill') window.setTimeout(activateKillSwitch, 420);
    if (captureMode === 'red-summary') {
      applyPreset('compliant'); submitAttempt();
      window.setTimeout(() => { applyPreset('oversized'); submitAttempt(); }, 260);
    }
  }, 80);

  resetLab();
  return Object.freeze({
    open,
    close,
    reset: resetLab,
    submit: values => session.attempt(values),
    freeze: () => session.freezePending(),
    settle: () => session.settlePending(),
    diagnostics: () => ({
      open: !modal.classList.contains('hidden'),
      running,
      countdownSeconds,
      summary: session.getSummary(),
      snapshot: session.engine.getSnapshot(),
      lastOutcome: session.lastOutcome,
      pipeline: $$('#redTeamPipeline li').map(item => ({ label: item.textContent.trim(), state: item.className })),
      error: $('#redTeamError').textContent,
    }),
  });
}
