# Aegis Sentinel — Lyzr Advisory Integration

## Purpose and boundary

**AEGIS SENTINEL** is the Lyzr-powered policy hardening agent. It reviews sanitized evidence from simulated Aegis incidents and may recommend a bounded policy tightening. It is advisory only.

> Sentinel advises. The deterministic Aegis engine and Policy Wallet remain the enforcement authority.

Sentinel cannot approve or block a transaction, mutate engine state, rewrite ledger evidence, activate a policy, add a recipient, increase a limit or budget, shorten settlement delay, weaken the violation threshold, move test funds, settle an intent, freeze an agent, or invoke the Kill Switch.

## Architecture

```text
Canonical Aegis Engine
  → sanitized simulated ledger evidence
  → POST /api/lyzr-sentinel (same origin)
  → Lyzr Agent API
  → strict local response validation
  → human review
  → deterministic Policy Digital Twin simulation
  → optional later owner action through the existing policy workflow
```

The browser only calls `/api/lyzr-sentinel`. The serverless function reads `LYZR_API_KEY`, `LYZR_AGENT_ID`, `LYZR_API_URL`, and `LYZR_ENABLED` from the deployment environment. No credential is compiled into `public/`, returned to the browser, logged, or placed in screenshots.

## Agent identity and API envelope

- Agent name: **AEGIS SENTINEL**
- Role: Lyzr-powered policy hardening agent
- Agent ID: supplied at deployment through `LYZR_AGENT_ID`
- Repository status: no Agent JSON export or concrete Agent ID was supplied in the audited workspace, so no identifier has been invented or committed
- Recommended endpoint value: the exact HTTPS URL displayed by the deployed agent’s Lyzr Inference panel

The proxy follows Lyzr’s documented v3 chat inference envelope: `user_id`, `agent_id`, `session_id`, `message`, `system_prompt_variables`, `filter_variables`, and `features`, authenticated server-side with `x-api-key`. The first-party reference is [Lyzr Chat With Agent (Inference v3)](https://docs.lyzr.ai/agent-apis/agents/MultimodalChat).

## Request controls and deployment diagnostics

- `POST` is the only advisory request method and accepts JSON only
- `GET /api/lyzr-sentinel` returns only `enabled`, `configured`, and a bounded status; it never returns an environment value, Agent JSON, upstream header, URL, ID, or key
- configuration states are `DISABLED`, `INCOMPLETE_CONFIGURATION`, and `READY`; a configured upstream failure is normalized as `UPSTREAM_UNAVAILABLE`, while a validated response is `SUCCESS`
- 48 KiB request ceiling
- same-origin browser request required
- versioned `TEST_ENVIRONMENT` or `LOCAL_EVM` evidence only
- deterministic ledger evidence required
- user-entered recipients are reduced to `APPROVED_RECIPIENT` or `UNAPPROVED_RECIPIENT`
- control characters, executable markup, email addresses, payment-card-like numbers, account identifiers, and phone-like data are rejected
- values are safe integer paise
- stable pseudonymous `user_id` and incident-specific `session_id` are hashed on the server
- 11-second upstream timeout with abort
- normalized errors; no upstream headers or secrets

## Structured recommendation schema

Required response fields:

- `incident_summary`
- `attack_classification`
- `severity`
- `evidence_sufficient`
- `evidence_ids`
- `decisive_rules`
- `recommended_patch`
- `change_required`
- `rationale`
- `human_approval_required`
- `confidence`
- `limitations`

The proxy rejects unknown top-level and patch fields. `human_approval_required` must be `true`. Evidence IDs must exist in the supplied ledger. A recommendation cannot increase the per-transaction limit, daily limit, or total budget; cannot shorten settlement delay; cannot weaken the violation threshold; cannot add recipients; and cannot remove every approved recipient. Limits must remain internally consistent with the proposed total budget.

The browser repeats the authority-bound checks before displaying a cached or fresh recommendation. Only a validated patch can enter `runPolicyDigitalTwin`, and simulation never activates it.

## Credit safety

- no page-load call
- no per-transaction automatic call
- explicit **ASK AEGIS SENTINEL** action only
- one in-flight client request
- click cooldown
- deterministic incident-hash cache in `sessionStorage`
- cached replay does not call Lyzr
- cache clears only through the explicit **Clear Sentinel cache** action
- automated tests use mocked upstream responses
- `scripts/test-lyzr-live.mjs` refuses to run without `ALLOW_LYZR_LIVE=1` and makes at most one same-origin request

## Environment setup

```text
LYZR_ENABLED=1
LYZR_API_URL=https://agent-prod.studio.lyzr.ai/v3/inference/chat/
LYZR_AGENT_ID=<agent id from the Lyzr Inference panel>
LYZR_API_KEY=<deployment secret>
```

Do not place these values in `public/`, screenshots, issue comments, or chat. The Agent ID is not itself a secret, but this repository intentionally does not invent one when the actual deployed identifier is unavailable.

## Demo path

1. Run a deterministic scenario in Judge Mode, Red Team Lab, or the Control Centre.
2. Open Forensics, Policy Digital Twin, the Red Team result, or Judge evidence.
3. Select **ASK AEGIS SENTINEL**.
4. Review the classification, evidence IDs, bounded patch, rationale, confidence, limitations, and human-approval requirement.
5. Select **SIMULATE RECOMMENDATION**.
6. Confirm that the same canonical six-attack suite runs against current and proposed policies.
7. Confirm that no policy was activated and no transaction or ledger state changed.

If the Lyzr service or deployment configuration is unavailable, the advisory panel says so while the deterministic engine, contract evidence, Judge Mode, Red Team Lab, ledger, settlement, and owner Kill Switch remain operational.

## Limitations

- This release does not claim that Lyzr makes enforcement decisions.
- A concrete Agent ID and sanitized Agent JSON export were not present locally; production configuration remains an operator step.
- The integration sends only simulated Aegis evidence and is not designed for personal data or real financial records.
- Digital Twin output is deterministic simulation, not automatic policy activation.
- Local-EVM contract verification remains separate from browser execution.
