import { createHash } from 'node:crypto';

if (process.env.ALLOW_LYZR_LIVE !== '1') {
  process.stderr.write('REFUSED: set ALLOW_LYZR_LIVE=1 to permit one explicit Sentinel smoke request.\n');
  process.exit(2);
}

const endpoint = process.env.LYZR_SMOKE_URL;
if (!endpoint) throw new Error('LYZR_SMOKE_URL must identify the same-origin /api/lyzr-sentinel endpoint.');
const url = new URL(endpoint);
if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') throw new Error('Sentinel smoke endpoint must use HTTPS.');

const base = {
  schema_version: 1,
  simulated_funds: true,
  environment: 'TEST_ENVIRONMENT',
  context: 'MANUAL_SMOKE_TEST',
  policy: {
    version: 4,
    per_transaction_limit_paise: 250000,
    daily_cumulative_limit_paise: 750000,
    total_budget_paise: 1000000,
    settlement_delay_seconds: 10,
    violation_threshold: 55,
    approved_recipients: ['CloudGrid', 'ComputeHub'],
  },
  evidence: [{
    id: 'SMOKE-EVIDENCE-001', event_type: 'AUTHORISATION', decision: 'BLOCK', decisive_rule: 'PER_TRANSACTION_LIMIT',
    risk_state: 'CAUTION', policy_version: 4, final_status: 'BLOCKED', funds_moved_paise: 0,
    intent_amount_paise: 250100, recipient_class: 'APPROVED_RECIPIENT',
  }],
};
const incidentHash = createHash('sha256').update(JSON.stringify(base)).digest('hex');
const payload = { ...base, client_id: 'manual-smoke-test', incident_hash: incidentHash };

const response = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: url.origin, 'sec-fetch-site': 'same-origin' },
  body: JSON.stringify(payload),
});
const body = await response.json().catch(() => ({}));
process.stdout.write(`${JSON.stringify({ status: response.status, ok: response.ok, advisoryOnly: body.advisory_only === true, error: body.error ?? null }, null, 2)}\n`);
if (!response.ok) process.exitCode = 1;
