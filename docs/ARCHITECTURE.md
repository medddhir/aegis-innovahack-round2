# Aegis Prototype Architecture

Aegis is an independent financial guardrail layer for autonomous agents. The Round 2 prototype uses simulated INR and deterministic scenarios; no real funds move.

## Control flow

```text
Autonomous agent
  -> transaction intent
  -> identity and task binding
  -> deterministic policy checks
  -> adaptive risk checks
  -> two-phase settlement queue
  -> final revalidation
  -> simulated protected wallet
```

The agent never receives unrestricted settlement authority. It may request a payment; Aegis owns the final approve, hold, block, invalidate, or freeze decision.

## Canonical engine

`public/policy-engine.js` is the single source of enforcement truth. It is a dependency-free ES module used directly by the browser and by `tests/policy-engine.test.js`.

Every transaction uses this intent shape:

```text
id, agentId, taskId, amount, recipient, category, requestedAt,
expiresAt, policyVersion, nonce, status
```

The active policy contains the owner, authorised agent, task identity, total and daily budgets, per-transaction cap, recipient allowlist, category, expiry, settlement delay, violation threshold, policy version, active/frozen status, and feature switches used by the Digital Twin.

## Deterministic rule order

Authorisation stops on the first failed rule:

1. `AGENT_EXISTS`
2. `AGENT_NOT_FROZEN`
3. `POLICY_VERSION_CURRENT`
4. `TASK_MATCHES_CAPSULE`
5. `CAPSULE_NOT_EXPIRED`
6. `RECIPIENT_ALLOWLISTED`
7. `CATEGORY_MATCHES`
8. `AMOUNT_POSITIVE`
9. `PER_TRANSACTION_LIMIT`
10. `CUMULATIVE_BUDGET`
11. `NONCE_UNIQUE`
12. `EVASION_SHIELD`
13. `RISK_GOVERNOR`
14. `FINAL_SETTLEMENT_REVALIDATION` immediately before settlement

Each result records the rule, pass/fail state, exact reason, policy version, risk state and score, funds moved, timestamp, and the ordered rule trace.

## Risk thresholds and responses

Risk scoring is deterministic: base 12; first blocked incident +20 and later blocked incidents +5; unknown-recipient incident +20; retry after rejection +25; split-payment behaviour +25; policy-modification attempt +20; peak velocity +12 at four to seven requests or +50 at eight requests in ten seconds. The single highest applicable velocity weight is used.

- `NORMAL` 0–29: standard policy settlement delay.
- `CAUTION` 30–54: heightened evidence logging and a minimum 15-second delay.
- `RESTRICTED` 55–74: new recipients remain disallowed, otherwise valid requests require owner approval, and delay increases to 30 seconds.
- `QUARANTINED` 75–94: autonomous settlement is disabled; otherwise valid requests require owner approval.
- `FROZEN` 95–100: new requests are blocked and pending intents fail revalidation.

The owner-controlled freeze is stronger and immediate: it advances the policy version, invalidates every pending intent, records the owner action, and moves zero funds.

## Evidence and repeatability

The Forensic Proof Ledger is written by the engine, not by the display layer. Attack Replay reads those recorded events. Reset reconstructs the original policy/runtime state, clears nonces, pending and approval queues, timers, ledger events, Digital Twin output, attack output, and Judge Mode progress. The demo clock and identifiers restart from a fixed epoch so an identical scenario produces identical evidence after reset.

## Presentation boundary

`public/app.js` is a projection layer over engine snapshots, decisions, `rulesEvaluated`, and ledger events. It may format INR, select the current panel, animate a returned state, and coordinate Judge Mode presentation; it may not calculate approval, risk, settlement, or evidence independently. `public/judge-mode.js` owns only the demo lifecycle and timer cleanup. `public/styles.css` maps returned states to visual treatment without delaying or changing them.

The live intent stream and forensic terminal read recorded ledger entries. Metric transitions terminate at the engine snapshot value, and reduced-motion mode writes that value directly. Browser diagnostics are read-only and exist to verify visible state against the engine during local tests.

## Locked innovations

1. Task-Bound Budget Capsules
2. Adaptive Risk Governor
3. Evasion Shield
4. Two-Phase Settlement with In-Flight Revocation
5. Policy Digital Twin
6. Forensic Proof Ledger and Attack Replay

## Prototype boundary

The system is a deterministic financial-control demonstration using simulated balances, recipients, policies, and transaction intents. A production real-money version would require security review, applicable regulatory approvals, and integrations with licensed financial or payment partners.
