import { createHash } from 'node:crypto';
import { parseLyzrResponse, SentinelValidationError, validateIncident, validateRecommendation } from '../lib/sentinel-validation.js';

const MAX_REQUEST_BYTES = 48 * 1024;
const TIMEOUT_MS = 11_000;
const json = (res, status, body) => res.status(status).json(body);

function configuration(env = process.env) {
  const enabled = env.LYZR_ENABLED === '1' || env.LYZR_ENABLED === 'true';
  if (!enabled) return { enabled: false, configured: false, status: 'DISABLED', apiKey: null, agentId: null, apiUrl: null };
  const apiKey = env.LYZR_API_KEY;
  const agentId = env.LYZR_AGENT_ID;
  const apiUrl = env.LYZR_API_URL;
  if (!apiKey || !agentId || !apiUrl) return { enabled: true, configured: false, status: 'INCOMPLETE_CONFIGURATION', apiKey: null, agentId: null, apiUrl: null };
  try {
    const url = new URL(apiUrl);
    if (url.protocol !== 'https:') throw new Error('HTTPS required');
    return { enabled: true, configured: true, status: 'READY', apiKey, agentId, apiUrl: url };
  } catch {
    return { enabled: true, configured: false, status: 'INCOMPLETE_CONFIGURATION', apiKey: null, agentId: null, apiUrl: null };
  }
}

export function sentinelConfiguration(env = process.env) {
  const { enabled, configured, status } = configuration(env);
  return Object.freeze({ enabled, configured, status });
}

function sameOrigin(req) {
  const origin = req.headers?.origin;
  const host = req.headers?.['x-forwarded-host'] ?? req.headers?.host;
  const fetchSite = req.headers?.['sec-fetch-site'];
  if (!origin || !host) return false;
  try {
    if (new URL(origin).host !== String(host).split(',')[0].trim()) return false;
  } catch { return false; }
  return !fetchSite || fetchSite === 'same-origin';
}

function stableId(prefix, value) {
  return `${prefix}_${createHash('sha256').update(`aegis-sentinel:${value}`).digest('hex').slice(0, 32)}`;
}

function sentinelMessage(incident) {
  return JSON.stringify({
    instruction: 'Analyze only the supplied simulated Aegis forensic evidence. Return one strict JSON object matching the requested schema. Recommend only controls that preserve or reduce authority. Do not add recipients, increase limits or budgets, shorten settlement delay, weaken the violation threshold, approve transactions, move funds, or activate policy.',
    required_schema: {
      incident_summary: 'string', attack_classification: 'string', severity: 'LOW|MEDIUM|HIGH|CRITICAL',
      evidence_sufficient: 'boolean', evidence_ids: ['supplied evidence id'], decisive_rules: ['rule'],
      recommended_patch: { per_transaction_limit_paise: 'safe integer optional', daily_cumulative_limit_paise: 'safe integer optional', total_budget_paise: 'safe integer optional', settlement_delay_seconds: 'safe integer optional', violation_threshold: 'safe integer optional', remove_recipients: ['current allowlist member optional'] },
      change_required: 'boolean', rationale: 'string', human_approval_required: true, confidence: 'number 0..1', limitations: ['string'],
    },
    incident,
  });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  const config = configuration();
  if (req.method === 'GET') {
    const { enabled, configured, status } = config;
    return json(res, 200, { ok: true, enabled, configured, status, advisory_only: true });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED', message: 'Sentinel accepts GET diagnostics and POST advisory requests only.' });
  }
  if (!sameOrigin(req)) return json(res, 403, { ok: false, error: 'SAME_ORIGIN_REQUIRED', message: 'Sentinel requests must originate from this Aegis deployment.' });
  if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) return json(res, 415, { ok: false, error: 'JSON_REQUIRED', message: 'Sentinel accepts JSON only.' });
  const declaredLength = Number(req.headers?.['content-length'] ?? 0);
  const serializedLength = Buffer.byteLength(JSON.stringify(req.body ?? {}));
  if ((declaredLength && declaredLength > MAX_REQUEST_BYTES) || serializedLength > MAX_REQUEST_BYTES) return json(res, 413, { ok: false, error: 'REQUEST_TOO_LARGE', message: 'Sentinel evidence exceeds the request limit.' });

  if (!config.enabled) return json(res, 503, { ok: false, error: 'SENTINEL_DISABLED', status: config.status, message: 'Advisory analysis is disabled. Deterministic Aegis enforcement remains operational.' });
  if (!config.configured) return json(res, 503, { ok: false, error: 'SENTINEL_INCOMPLETE_CONFIGURATION', status: config.status, message: 'Advisory analysis is not configured. Deterministic Aegis enforcement remains operational.' });

  let incident;
  try { incident = validateIncident(req.body); }
  catch (error) {
    const code = error instanceof SentinelValidationError ? error.code : 'INVALID_INCIDENT';
    return json(res, 400, { ok: false, error: code, message: error.message });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(config.apiUrl, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': config.apiKey },
      body: JSON.stringify({
        user_id: stableId('user', incident.client_id),
        agent_id: config.agentId,
        session_id: stableId('incident', incident.incident_hash),
        message: sentinelMessage(incident),
        system_prompt_variables: {},
        filter_variables: {},
        features: [],
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) return json(res, 502, { ok: false, error: 'SENTINEL_UPSTREAM_UNAVAILABLE', status: 'UPSTREAM_UNAVAILABLE', message: 'Advisory analysis is unavailable. Deterministic Aegis enforcement remains operational.' });
    const payload = await upstream.json();
    const recommendation = validateRecommendation(parseLyzrResponse(payload), incident);
    return json(res, 200, { ok: true, status: 'SUCCESS', recommendation, incident_hash: incident.incident_hash, advisory_only: true });
  } catch (error) {
    if (error?.name === 'AbortError') return json(res, 504, { ok: false, error: 'SENTINEL_TIMEOUT', message: 'Advisory analysis timed out. Deterministic Aegis enforcement remains operational.' });
    if (error instanceof SentinelValidationError) return json(res, 502, { ok: false, error: error.code, message: 'The advisory response failed Aegis safety validation and was not accepted.' });
    return json(res, 502, { ok: false, error: 'SENTINEL_UPSTREAM_UNAVAILABLE', status: 'UPSTREAM_UNAVAILABLE', message: 'Advisory analysis is unavailable. Deterministic Aegis enforcement remains operational.' });
  } finally {
    clearTimeout(timeout);
  }
}

export { MAX_REQUEST_BYTES, TIMEOUT_MS, sameOrigin, stableId };
