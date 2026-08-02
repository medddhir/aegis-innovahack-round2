const MAX_TEXT = 600;
const MAX_EVIDENCE = 24;
const TOP_LEVEL_FIELDS = new Set([
  'incident_summary', 'attack_classification', 'severity', 'evidence_sufficient',
  'evidence_ids', 'decisive_rules', 'recommended_patch', 'change_required',
  'rationale', 'human_approval_required', 'confidence', 'limitations',
]);
const PATCH_FIELDS = new Set([
  'per_transaction_limit_paise', 'daily_cumulative_limit_paise', 'total_budget_paise',
  'settlement_delay_seconds', 'violation_threshold', 'remove_recipients',
]);

export class SentinelValidationError extends Error {
  constructor(message, code = 'INVALID_SENTINEL_DATA') {
    super(message);
    this.name = 'SentinelValidationError';
    this.code = code;
  }
}

const plainObject = value => value && typeof value === 'object' && !Array.isArray(value);

function exactKeys(object, allowed, label) {
  if (!plainObject(object)) throw new SentinelValidationError(`${label} must be an object.`);
  const unknown = Object.keys(object).filter(key => !allowed.has(key));
  if (unknown.length) throw new SentinelValidationError(`${label} contains unsupported fields.`);
}

export function safeText(value, label, { max = MAX_TEXT } = {}) {
  if (typeof value !== 'string') throw new SentinelValidationError(`${label} must be text.`);
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > max) throw new SentinelValidationError(`${label} is empty or too long.`);
  if (/<\/?[a-z][^>]*>|javascript:|data:text\/html/i.test(normalized)) throw new SentinelValidationError(`${label} contains executable markup.`);
  return normalized;
}

function safeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new SentinelValidationError(`${label} must be a safe integer.`);
  return value;
}

function safeTextList(value, label, { maxItems = MAX_EVIDENCE, itemMax = 160 } = {}) {
  if (!Array.isArray(value) || value.length > maxItems) throw new SentinelValidationError(`${label} must be a bounded array.`);
  return [...new Set(value.map((item, index) => safeText(item, `${label}[${index}]`, { max: itemMax })) )];
}

function rejectPersonalData(value) {
  const serialized = JSON.stringify(value);
  const patterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /\b(?:\d[ -]*?){12,19}\b/,
    /\b(?:account|a\/c|iban|ifsc|routing)\s*(?:number|no\.?|id)?\s*[:#-]?\s*[A-Z0-9-]{6,}\b/i,
    /\b(?:\+?\d[\s().-]*){10,14}\b/,
  ];
  if (patterns.some(pattern => pattern.test(serialized))) {
    throw new SentinelValidationError('Real personal or financial data is not accepted.', 'REAL_DATA_REJECTED');
  }
}

export function validateIncident(input) {
  const allowed = new Set(['schema_version', 'simulated_funds', 'environment', 'context', 'client_id', 'incident_hash', 'policy', 'evidence']);
  exactKeys(input, allowed, 'Incident');
  if (input.schema_version !== 1 || input.simulated_funds !== true || !['TEST_ENVIRONMENT', 'LOCAL_EVM'].includes(input.environment)) {
    throw new SentinelValidationError('Only versioned simulated Aegis evidence is accepted.', 'SIMULATED_EVIDENCE_REQUIRED');
  }
  const context = safeText(input.context, 'Incident context', { max: 48 });
  const clientId = safeText(input.client_id, 'Client identifier', { max: 96 });
  const incidentHash = safeText(input.incident_hash, 'Incident hash', { max: 96 });
  if (!/^[a-f0-9]{64}$/i.test(incidentHash)) throw new SentinelValidationError('Incident hash is invalid.');

  const policyFields = new Set(['version', 'per_transaction_limit_paise', 'daily_cumulative_limit_paise', 'total_budget_paise', 'settlement_delay_seconds', 'violation_threshold', 'approved_recipients']);
  exactKeys(input.policy, policyFields, 'Policy');
  const policy = {
    version: safeInteger(input.policy.version, 'Policy version', { min: 1, max: 1_000_000 }),
    per_transaction_limit_paise: safeInteger(input.policy.per_transaction_limit_paise, 'Per-transaction limit', { min: 1 }),
    daily_cumulative_limit_paise: safeInteger(input.policy.daily_cumulative_limit_paise, 'Daily limit', { min: 1 }),
    total_budget_paise: safeInteger(input.policy.total_budget_paise, 'Total budget', { min: 1 }),
    settlement_delay_seconds: safeInteger(input.policy.settlement_delay_seconds, 'Settlement delay', { min: 0, max: 86_400 }),
    violation_threshold: safeInteger(input.policy.violation_threshold, 'Violation threshold', { min: 1, max: 100 }),
    approved_recipients: safeTextList(input.policy.approved_recipients, 'Approved recipients', { maxItems: 24, itemMax: 64 }),
  };
  if (!policy.approved_recipients.length) throw new SentinelValidationError('At least one approved recipient is required.');

  if (!Array.isArray(input.evidence) || !input.evidence.length || input.evidence.length > MAX_EVIDENCE) {
    throw new SentinelValidationError('Deterministic ledger evidence is required.', 'DETERMINISTIC_EVIDENCE_REQUIRED');
  }
  const evidenceFields = new Set(['id', 'event_type', 'decision', 'decisive_rule', 'risk_state', 'policy_version', 'final_status', 'funds_moved_paise', 'intent_amount_paise', 'recipient_class']);
  const evidence = input.evidence.map((event, index) => {
    exactKeys(event, evidenceFields, `Evidence ${index + 1}`);
    return {
      id: safeText(event.id, `Evidence ${index + 1} id`, { max: 96 }),
      event_type: safeText(event.event_type, `Evidence ${index + 1} event type`, { max: 64 }),
      decision: safeText(event.decision, `Evidence ${index + 1} decision`, { max: 48 }),
      decisive_rule: safeText(event.decisive_rule, `Evidence ${index + 1} rule`, { max: 96 }),
      risk_state: safeText(event.risk_state, `Evidence ${index + 1} risk`, { max: 48 }),
      policy_version: safeInteger(event.policy_version, `Evidence ${index + 1} policy version`, { min: 1, max: 1_000_000 }),
      final_status: safeText(event.final_status, `Evidence ${index + 1} status`, { max: 48 }),
      funds_moved_paise: safeInteger(event.funds_moved_paise, `Evidence ${index + 1} funds moved`),
      intent_amount_paise: safeInteger(event.intent_amount_paise, `Evidence ${index + 1} amount`),
      recipient_class: safeText(event.recipient_class, `Evidence ${index + 1} recipient class`, { max: 64 }),
    };
  });
  rejectPersonalData({ context, policy, evidence });
  return { schema_version: 1, simulated_funds: true, environment: input.environment, context, client_id: clientId, incident_hash: incidentHash.toLowerCase(), policy, evidence };
}

export function validateRecommendation(input, incident) {
  exactKeys(input, TOP_LEVEL_FIELDS, 'Recommendation');
  for (const field of TOP_LEVEL_FIELDS) if (!(field in input)) throw new SentinelValidationError(`Recommendation is missing ${field}.`);
  if (!['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(input.severity)) throw new SentinelValidationError('Severity is invalid.');
  if (typeof input.evidence_sufficient !== 'boolean' || typeof input.change_required !== 'boolean') throw new SentinelValidationError('Recommendation booleans are invalid.');
  if (input.human_approval_required !== true) throw new SentinelValidationError('Human approval must be required.', 'HUMAN_APPROVAL_REQUIRED');
  if (typeof input.confidence !== 'number' || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) throw new SentinelValidationError('Confidence must be between zero and one.');

  const evidenceIds = safeTextList(input.evidence_ids, 'Evidence IDs');
  const suppliedIds = new Set(incident.evidence.map(event => event.id));
  if (evidenceIds.some(id => !suppliedIds.has(id))) throw new SentinelValidationError('Recommendation cites evidence that was not supplied.');
  const decisiveRules = safeTextList(input.decisive_rules, 'Decisive rules', { maxItems: 14 });
  const limitations = safeTextList(input.limitations, 'Limitations', { maxItems: 12, itemMax: 240 });

  exactKeys(input.recommended_patch, PATCH_FIELDS, 'Recommended patch');
  const patch = {};
  const current = incident.policy;
  const bounded = [
    ['per_transaction_limit_paise', current.per_transaction_limit_paise, 1],
    ['daily_cumulative_limit_paise', current.daily_cumulative_limit_paise, 1],
    ['total_budget_paise', current.total_budget_paise, 1],
  ];
  for (const [field, ceiling, minimum] of bounded) {
    if (!(field in input.recommended_patch)) continue;
    patch[field] = safeInteger(input.recommended_patch[field], field, { min: minimum });
    if (patch[field] > ceiling) throw new SentinelValidationError(`${field} cannot increase the current authority.`, 'UNSAFE_POLICY_INCREASE');
  }
  if ('settlement_delay_seconds' in input.recommended_patch) {
    patch.settlement_delay_seconds = safeInteger(input.recommended_patch.settlement_delay_seconds, 'Settlement delay', { min: 0, max: 86_400 });
    if (patch.settlement_delay_seconds < current.settlement_delay_seconds) throw new SentinelValidationError('Settlement delay cannot be shortened.', 'UNSAFE_POLICY_WEAKENING');
  }
  if ('violation_threshold' in input.recommended_patch) {
    patch.violation_threshold = safeInteger(input.recommended_patch.violation_threshold, 'Violation threshold', { min: 1, max: 100 });
    if (patch.violation_threshold > current.violation_threshold) throw new SentinelValidationError('Violation threshold cannot be weakened.', 'UNSAFE_POLICY_WEAKENING');
  }
  if ('remove_recipients' in input.recommended_patch) {
    patch.remove_recipients = safeTextList(input.recommended_patch.remove_recipients, 'Recipients to remove', { maxItems: 24, itemMax: 64 });
    const allowed = new Set(current.approved_recipients);
    if (patch.remove_recipients.some(recipient => !allowed.has(recipient))) throw new SentinelValidationError('Recipients may only be removed from the current allowlist.', 'RECIPIENT_ADDITION_REJECTED');
    if (patch.remove_recipients.length >= current.approved_recipients.length) throw new SentinelValidationError('At least one approved recipient must remain.', 'UNSAFE_POLICY_WEAKENING');
  }
  const proposedTotal = patch.total_budget_paise ?? current.total_budget_paise;
  const proposedTransaction = patch.per_transaction_limit_paise ?? current.per_transaction_limit_paise;
  const proposedDaily = patch.daily_cumulative_limit_paise ?? current.daily_cumulative_limit_paise;
  if (proposedTransaction > proposedTotal || proposedDaily > proposedTotal) throw new SentinelValidationError('Recommended limits must remain within the proposed total budget.', 'UNSAFE_POLICY_INCREASE');
  if (input.change_required && !Object.keys(patch).length) throw new SentinelValidationError('A required change must include a bounded patch.');

  return {
    incident_summary: safeText(input.incident_summary, 'Incident summary'),
    attack_classification: safeText(input.attack_classification, 'Attack classification', { max: 96 }),
    severity: input.severity,
    evidence_sufficient: input.evidence_sufficient,
    evidence_ids: evidenceIds,
    decisive_rules: decisiveRules,
    recommended_patch: patch,
    change_required: input.change_required,
    rationale: safeText(input.rationale, 'Rationale'),
    human_approval_required: true,
    confidence: input.confidence,
    limitations,
  };
}

export function parseLyzrResponse(payload) {
  const raw = payload?.response ?? payload?.agent_response;
  if (plainObject(raw)) return raw;
  if (typeof raw !== 'string') throw new SentinelValidationError('Lyzr returned no structured recommendation.', 'INVALID_UPSTREAM_RESPONSE');
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); }
  catch { throw new SentinelValidationError('Lyzr returned invalid structured JSON.', 'INVALID_UPSTREAM_RESPONSE'); }
}

export const SENTINEL_SCHEMA_FIELDS = Object.freeze([...TOP_LEVEL_FIELDS]);
