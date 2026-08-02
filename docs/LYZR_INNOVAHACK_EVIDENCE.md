# Lyzr InnovaHack Evidence — Aegis Sentinel

## Submission identity

- Product: **Aegis**
- Integration: **AEGIS SENTINEL — Lyzr-powered policy hardening agent**
- Organization: **TurboPay Technologies Pvt. Ltd.**
- Suggested repository metadata: `InnovaHack`, `FinTech`, `Aegis`, `Agentic Security`, `TurboPay Technologies`

## What Lyzr contributes

Lyzr performs an explicit, human-requested advisory review of sanitized deterministic forensic evidence. It classifies the incident, cites supplied evidence IDs and decisive rules, and proposes only a bounded tightening of the existing policy. Aegis validates that output twice—server-side and in the browser—before allowing a Policy Digital Twin simulation.

## What Lyzr does not do

Lyzr is not in the transaction decision path. It cannot approve, block, settle, freeze, modify the canonical ledger, add a recipient, expand authority, or activate a policy. The deterministic browser engine explains the decision and the Solidity Aegis Policy Wallet independently enforces overlapping settlement controls with mock/test funds.

## Verifiable implementation evidence

- Same-origin proxy: `api/lyzr-sentinel.js`
- Strict schemas and safety bounds: `lib/sentinel-validation.js`
- Credit-safe client and Digital Twin adapter: `public/sentinel.js`
- Presentation: `public/index.html`, `public/release-candidate.css`
- Opt-in live smoke: `scripts/test-lyzr-live.mjs`
- Automated mocked tests: `tests/final-release-candidate.test.js`
- Generated project proof: `public/project-proof.json`

## Live integration route

`POST /api/lyzr-sentinel`

The route is inert unless `LYZR_ENABLED` is true and the deployment provides `LYZR_API_URL`, `LYZR_AGENT_ID`, and `LYZR_API_KEY`. This is deliberate fail-closed behavior. No normal automated command makes a live Lyzr request.

## Screenshot checklist

Release evidence belongs under `docs/screenshots/final-release-candidate/`:

1. Sentinel idle
2. Sentinel loading with mocked upstream
3. validated recommendation
4. deterministic Twin simulation
5. advisory-unavailable state
6. mobile Sentinel

No screenshot may include credentials, environment-variable values, upstream headers, personal data, or real financial records.

## Known operator step

No Lyzr Agent export or concrete Agent ID was available in the workspace. Before a public demo of the live advisory call, the operator must configure the actual deployed AEGIS SENTINEL agent in Vercel and run the single-request smoke command with explicit permission. The deterministic Aegis demo does not depend on that optional call.
