import { runPolicyDigitalTwin } from './policy-engine.js';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const CACHE_PREFIX = 'aegis-sentinel-cache:';
const CLIENT_ID_KEY = 'aegis-sentinel-client-id';
const COOLDOWN_MS = 2_500;

const clone = value => JSON.parse(JSON.stringify(value));
const paise = value => Math.round(Number(value ?? 0) * 100);
const formatINR = amount => `₹${Number(amount ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function sessionGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}

function sessionSet(key, value) {
  try { sessionStorage.setItem(key, value); return true; } catch { return false; }
}

function clientId() {
  const existing = sessionGet(CLIENT_ID_KEY);
  if (existing) return existing;
  const created = globalThis.crypto?.randomUUID?.() ?? `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  sessionSet(CLIENT_ID_KEY, created);
  return created;
}

async function digest(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Secure incident hashing is unavailable in this browser.');
  const bytes = new TextEncoder().encode(value);
  const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function normalizeSentinelEvidence(ledger = [], policy = {}) {
  const allowlist = new Set(policy.approvedRecipients ?? []);
  return ledger.slice(-24).map((event, index) => {
    const recipient = event.intent?.recipient;
    return {
      id: String(event.eventId ?? event.id ?? `${event.intent?.id ?? 'POLICY'}-${event.eventType ?? 'EVENT'}-${index + 1}`),
      event_type: String(event.eventType ?? 'POLICY_EVENT'),
      decision: String(event.decision ?? 'RECORDED'),
      decisive_rule: String(event.ruleChecked ?? event.rulesEvaluated?.find(rule => !rule.passed)?.rule ?? event.rulesEvaluated?.at(-1)?.rule ?? 'RECORDED_EVIDENCE'),
      risk_state: String(event.riskState ?? 'NORMAL'),
      policy_version: Math.max(1, Number(event.policyVersion ?? policy.version ?? 1)),
      final_status: String(event.finalSettlementStatus ?? event.status ?? event.decision ?? 'RECORDED'),
      funds_moved_paise: Math.max(0, paise(event.fundsMoved)),
      intent_amount_paise: Math.max(0, paise(event.intent?.amount)),
      recipient_class: !recipient ? 'NO_RECIPIENT' : allowlist.has(recipient) ? 'APPROVED_RECIPIENT' : 'UNAPPROVED_RECIPIENT',
    };
  });
}

export function policyForSentinel(policy = {}) {
  return {
    version: Math.max(1, Number(policy.version ?? 1)),
    per_transaction_limit_paise: Math.max(1, paise(policy.perTransactionCap)),
    daily_cumulative_limit_paise: Math.max(1, paise(policy.dailyCumulativeCap)),
    total_budget_paise: Math.max(1, paise(policy.totalTaskBudget)),
    settlement_delay_seconds: Math.max(0, Math.round(Number(policy.settlementDelayMs ?? 0) / 1_000)),
    violation_threshold: Math.max(1, Math.round(Number(policy.violationThreshold ?? 1))),
    approved_recipients: [...(policy.approvedRecipients ?? [])].map(String),
  };
}

export function validateSentinelRecommendationClient(recommendation, policy, evidence = []) {
  if (!recommendation || recommendation.human_approval_required !== true) throw new TypeError('Human approval is required.');
  const patch = recommendation.recommended_patch;
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new TypeError('A bounded policy patch is required.');
  const allowedFields = new Set(['per_transaction_limit_paise', 'daily_cumulative_limit_paise', 'total_budget_paise', 'settlement_delay_seconds', 'violation_threshold', 'remove_recipients']);
  if (Object.keys(patch).some(field => !allowedFields.has(field))) throw new TypeError('Unsupported policy recommendation.');
  const current = policyForSentinel(policy);
  const bounded = [
    ['per_transaction_limit_paise', current.per_transaction_limit_paise], ['daily_cumulative_limit_paise', current.daily_cumulative_limit_paise], ['total_budget_paise', current.total_budget_paise],
  ];
  for (const [field, ceiling] of bounded) {
    if (patch[field] === undefined) continue;
    if (!Number.isSafeInteger(patch[field]) || patch[field] < 1 || patch[field] > ceiling) throw new TypeError(`${field} exceeds the current authority.`);
  }
  if (patch.settlement_delay_seconds !== undefined && (!Number.isSafeInteger(patch.settlement_delay_seconds) || patch.settlement_delay_seconds < current.settlement_delay_seconds)) throw new TypeError('Settlement delay cannot be shortened.');
  if (patch.violation_threshold !== undefined && (!Number.isSafeInteger(patch.violation_threshold) || patch.violation_threshold < 1 || patch.violation_threshold > current.violation_threshold)) throw new TypeError('Violation threshold cannot be weakened.');
  if (patch.remove_recipients !== undefined) {
    if (!Array.isArray(patch.remove_recipients) || patch.remove_recipients.some(recipient => !current.approved_recipients.includes(recipient)) || patch.remove_recipients.length >= current.approved_recipients.length) throw new TypeError('Recipient removal is outside the current allowlist boundary.');
  }
  const proposedTotal = patch.total_budget_paise ?? current.total_budget_paise;
  if ((patch.per_transaction_limit_paise ?? current.per_transaction_limit_paise) > proposedTotal || (patch.daily_cumulative_limit_paise ?? current.daily_cumulative_limit_paise) > proposedTotal) throw new TypeError('Recommended limits exceed the proposed total budget.');
  if (evidence.length) {
    const ids = new Set(evidence.map(event => event.id));
    if (!Array.isArray(recommendation.evidence_ids) || recommendation.evidence_ids.some(id => !ids.has(id))) throw new TypeError('Recommendation cites unknown evidence.');
  }
  return clone(recommendation);
}

export function applySentinelPatch(policy, recommendation) {
  const validated = validateSentinelRecommendationClient(recommendation, policy);
  const patch = validated.recommended_patch;
  const next = clone(policy);
  if (patch.per_transaction_limit_paise !== undefined) next.perTransactionCap = patch.per_transaction_limit_paise / 100;
  if (patch.daily_cumulative_limit_paise !== undefined) next.dailyCumulativeCap = patch.daily_cumulative_limit_paise / 100;
  if (patch.total_budget_paise !== undefined) next.totalTaskBudget = patch.total_budget_paise / 100;
  if (patch.settlement_delay_seconds !== undefined) next.settlementDelayMs = patch.settlement_delay_seconds * 1_000;
  if (patch.violation_threshold !== undefined) next.violationThreshold = patch.violation_threshold;
  if (patch.remove_recipients) next.approvedRecipients = next.approvedRecipients.filter(recipient => !patch.remove_recipients.includes(recipient));
  next.version = Number(next.version ?? 1) + 1;
  return next;
}

export function simulateSentinelRecommendation(policy, recommendation) {
  const proposed = applySentinelPatch(policy, recommendation);
  const result = runPolicyDigitalTwin({ legacyPolicy: clone(policy), hardenedPolicy: proposed });
  return Object.freeze({ currentPolicy: clone(policy), proposedPolicy: proposed, result });
}

function createList(target, items, emptyLabel = 'None recorded') {
  target.replaceChildren();
  const values = items?.length ? items : [emptyLabel];
  for (const value of values) {
    const item = document.createElement('li');
    item.textContent = String(value);
    target.append(item);
  }
}

function createPatchList(target, patch) {
  target.replaceChildren();
  const labels = {
    per_transaction_limit_paise: 'Per-transaction limit', daily_cumulative_limit_paise: 'Daily limit', total_budget_paise: 'Total budget',
    settlement_delay_seconds: 'Settlement delay', violation_threshold: 'Violation threshold', remove_recipients: 'Remove recipients',
  };
  const entries = Object.entries(patch ?? {});
  if (!entries.length) entries.push(['change', 'No policy change proposed']);
  for (const [key, value] of entries) {
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = labels[key] ?? 'Bounded recommendation';
    description.textContent = key.endsWith('_paise') ? formatINR(Number(value) / 100) : Array.isArray(value) ? value.join(', ') : String(value);
    target.append(term, description);
  }
}

function initSentinel() {
  const dialog = $('#sentinelDialog');
  if (!dialog) return;
  let opener = null;
  let context = 'FORENSIC_PROOF_LEDGER';
  let running = false;
  let lastRequestAt = 0;
  let activeRecommendation = null;
  let activePolicy = null;
  let requestCount = 0;
  let cacheHitCount = 0;
  let abortController = null;

  const views = { idle: $('#sentinelIdle'), loading: $('#sentinelLoading'), error: $('#sentinelError'), result: $('#sentinelResult') };
  const show = name => Object.entries(views).forEach(([key, node]) => node?.classList.toggle('hidden', key !== name));
  const announce = message => { $('#sentinelLive').textContent = message; };

  function diagnostics() {
    return window.__AEGIS_DIAGNOSTICS__;
  }

  function sourceEvidence() {
    const api = diagnostics();
    if (!api) throw new Error('Aegis diagnostics are not ready.');
    const red = api.redTeam?.();
    if (context === 'RED_TEAM_RESULT' && red?.lastOutcome?.ledgerEvents?.length) {
      return { policy: red.snapshot.policy, ledger: red.lastOutcome.ledgerEvents };
    }
    return { policy: api.engine().policy, ledger: api.ledger() };
  }

  async function incident() {
    const source = sourceEvidence();
    const evidence = normalizeSentinelEvidence(source.ledger, source.policy);
    if (!evidence.length) throw new Error('Run a deterministic Aegis scenario before requesting advisory analysis.');
    const base = {
      schema_version: 1,
      simulated_funds: true,
      environment: 'TEST_ENVIRONMENT',
      context,
      policy: policyForSentinel(source.policy),
      evidence,
    };
    const incidentHash = await digest(JSON.stringify(base));
    return { body: { ...base, client_id: clientId(), incident_hash: incidentHash }, policy: clone(source.policy), incidentHash };
  }

  function renderRecommendation(recommendation, policy, evidence = []) {
    const validated = validateSentinelRecommendationClient(recommendation, policy, evidence);
    activeRecommendation = validated;
    activePolicy = policy;
    $('#sentinelSeverity').textContent = `${validated.severity} SEVERITY`;
    $('#sentinelSeverity').dataset.severity = validated.severity.toLowerCase();
    $('#sentinelClassification').textContent = validated.attack_classification;
    $('#sentinelConfidence').textContent = `${Math.round(validated.confidence * 100)}% CONFIDENCE`;
    $('#sentinelSummary').textContent = validated.incident_summary;
    createList($('#sentinelEvidence'), validated.evidence_ids);
    createPatchList($('#sentinelPatch'), validated.recommended_patch);
    $('#sentinelRationale').textContent = validated.rationale;
    createList($('#sentinelLimitations'), validated.limitations);
    $('#sentinelTwin').classList.add('hidden');
    $('#sentinelSimulate').classList.toggle('hidden', !validated.evidence_sufficient);
    $('#sentinelAsk').textContent = 'ASK AEGIS SENTINEL';
    show('result');
    announce('Aegis Sentinel advisory recommendation received. Human approval is required.');
  }

  function renderError(message) {
    $('#sentinelErrorMessage').textContent = message;
    $('#sentinelAsk').disabled = false;
    $('#sentinelAsk').textContent = 'ASK AEGIS SENTINEL';
    show('error');
    announce(`Sentinel unavailable. ${message}`);
  }

  async function ask() {
    if (running) return;
    const now = Date.now();
    if (now - lastRequestAt < COOLDOWN_MS) return renderError('Please wait briefly before retrying advisory analysis.');
    let prepared;
    try { prepared = await incident(); }
    catch (error) { return renderError(error.message); }
    const cacheKey = `${CACHE_PREFIX}${prepared.incidentHash}`;
    const cached = sessionGet(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        cacheHitCount += 1;
        renderRecommendation(parsed, prepared.policy, prepared.body.evidence);
        announce('Cached Aegis Sentinel recommendation replayed without another Lyzr request.');
        return;
      } catch { /* An invalid cache entry is ignored but not silently trusted. */ }
    }

    running = true;
    lastRequestAt = now;
    requestCount += 1;
    $('#sentinelAsk').disabled = true;
    $('#sentinelAsk').textContent = 'ANALYSING…';
    show('loading');
    announce('Aegis Sentinel advisory analysis started.');
    abortController = new AbortController();
    const timeout = window.setTimeout(() => abortController.abort(), 12_500);
    try {
      const response = await fetch('/api/lyzr-sentinel', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(prepared.body), signal: abortController.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.ok || !payload.recommendation) throw new Error(payload.message ?? 'Advisory analysis is currently unavailable. Deterministic Aegis enforcement remains operational.');
      sessionSet(cacheKey, JSON.stringify(payload.recommendation));
      renderRecommendation(payload.recommendation, prepared.policy, prepared.body.evidence);
    } catch (error) {
      renderError(error.name === 'AbortError' ? 'Advisory analysis timed out. Deterministic Aegis enforcement remains operational.' : error.message);
    } finally {
      window.clearTimeout(timeout);
      abortController = null;
      running = false;
      $('#sentinelAsk').disabled = false;
      $('#sentinelAsk').textContent = 'ASK AEGIS SENTINEL';
    }
  }

  function simulate() {
    if (!activeRecommendation || !activePolicy) return;
    try {
      const simulation = simulateSentinelRecommendation(activePolicy, activeRecommendation);
      const current = simulation.result.legacy;
      const proposed = simulation.result.hardened;
      $('#sentinelTwinCurrent').textContent = `${current.attacksContained}/${current.attacks.length} ATTACKS CONTAINED`;
      $('#sentinelTwinProposed').textContent = `${proposed.attacksContained}/${proposed.attacks.length} ATTACKS CONTAINED`;
      const currentMoved = current.attacks.reduce((sum, attack) => sum + Number(attack.fundsMoved ?? 0), 0);
      const proposedMoved = proposed.attacks.reduce((sum, attack) => sum + Number(attack.fundsMoved ?? 0), 0);
      $('#sentinelTwinDifference').textContent = `Same deterministic attack suite · current simulated movement ${formatINR(currentMoved)} · proposed simulated movement ${formatINR(proposedMoved)} · no policy activated.`;
      $('#sentinelTwin').classList.remove('hidden');
      announce('Recommendation simulated through the deterministic Policy Digital Twin. No policy was activated.');
    } catch (error) { renderError(`Recommendation simulation was rejected: ${error.message}`); }
  }

  function open(event) {
    opener = event.currentTarget;
    context = opener.dataset.sentinelContext || 'FORENSIC_PROOF_LEDGER';
    $('#sentinelContext').textContent = context.replaceAll('_', ' ');
    activeRecommendation = null;
    activePolicy = null;
    $('#sentinelSimulate').classList.add('hidden');
    $('#sentinelTwin').classList.add('hidden');
    show('idle');
    document.body.classList.add('sentinel-open');
    window.UxScrollController?.pause?.();
    dialog.showModal();
    $('#sentinelAsk').focus({ preventScroll: true });
  }

  function close() {
    abortController?.abort();
    if (dialog.open) dialog.close();
    document.body.classList.remove('sentinel-open');
    window.UxScrollController?.resume?.();
    window.UxScrollController?.refresh?.();
    opener?.focus?.({ preventScroll: true });
  }

  function clearCache() {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(CACHE_PREFIX)) sessionStorage.removeItem(key);
      }
    } catch { /* Cache clearing is best-effort in restricted storage contexts. */ }
    show('idle');
    announce('Aegis Sentinel advisory cache cleared explicitly.');
  }

  $$('[data-sentinel-open]').forEach(button => button.addEventListener('click', open));
  $('#sentinelAsk').addEventListener('click', ask);
  $('#sentinelRetry').addEventListener('click', ask);
  $('#sentinelSimulate').addEventListener('click', simulate);
  $('#sentinelClearCache').addEventListener('click', clearCache);
  $('#sentinelClose').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  document.addEventListener('keydown', event => {
    if (!dialog.open || event.key !== 'Escape') return;
    event.preventDefault();
    event.stopImmediatePropagation();
    close();
  }, true);

  window.__AEGIS_SENTINEL__ = Object.freeze({
    ask,
    simulate,
    clearCache,
    diagnostics: () => ({ open: dialog.open, running, context, requestCount, cacheHitCount, hasRecommendation: Boolean(activeRecommendation) }),
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initSentinel, { once: true });
  else initSentinel();
}

export { CACHE_PREFIX, COOLDOWN_MS };
