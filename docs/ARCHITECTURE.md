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

## Independent settlement layer

`contracts/src/AegisPolicyWallet.sol` closes the contract-layer proof gap without replacing or modifying the canonical browser engine. It is a second implementation at the narrower settlement boundary:

```text
Browser risk layer                          Local-EVM settlement layer
behaviour + explanation                     Solidity role enforcement
task/category + Evasion Shield      ->       task hash + allowlist
Adaptive Risk Governor                      transaction/cumulative reservations
Judge and forensic evidence                 nonce + delayed execution
owner freeze                                frozen state + policy-version invalidation
```

The contract's owner creates policy and controls recipients, freeze, restore, cancellation, and policy changes. The authorised agent can only request. A valid request reserves Mock INR test tokens and enters `PENDING`; execution revalidates current authority immediately before transfer. Freeze and restore each advance `policyVersion`, so old pending intents stay stale permanently and their nonces cannot be reused.

The two implementations share eight machine-readable attack vectors for overlapping rules. `contracts/scripts/check-vector-parity.js` executes both sides and compares normalized outcomes, amounts, and rule categories. Behavioural split clustering intentionally remains a browser risk responsibility; the wallet independently enforces aggregate reservations and budgets.

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

`public/app.js` is a projection layer over engine snapshots, decisions, `rulesEvaluated`, and ledger events. It may format INR, select the current panel, animate a returned state, and coordinate Judge Mode presentation; it may not calculate approval, risk, settlement, or evidence independently. `public/judge-mode.js` owns only the demo lifecycle and timer cleanup. `public/visual-state.js` maps returned rules, decisions, risk states, transaction groups, Twin runs, and ledger stages into presentation models; it never evaluates a transaction. `public/styles.css` maps those returned states to visual treatment without delaying or changing them.

The live intent stream and forensic terminal read recorded ledger entries. Metric transitions terminate at the engine snapshot value, and reduced-motion mode writes that value directly. Browser diagnostics are read-only and exist to verify visible state against the engine during local tests.

The final public composition has five chapters—Thesis, Authority, Intervention, Proof, and The System—without adding another product layer. `public/aegis-rings.js` is the only WebGL scene. It reads the already-derived `data-flow` and `data-fail-layer` values on the hero instrument and draws four ring accents; it cannot submit, evaluate, settle, or mutate a transaction. The semantic SVG/CSS Core is always present beneath it. The enhancement is disabled on mobile, coarse pointers, reduced-motion, low-power devices, and context failure; it pauses off-screen and deletes its buffer and shader program on disposal.

## Locked innovations

1. Task-Bound Budget Capsules
2. Adaptive Risk Governor
3. Evasion Shield
4. Two-Phase Settlement with In-Flight Revocation
5. Policy Digital Twin
6. Forensic Proof Ledger and Attack Replay

## Prototype boundary

The browser system is a deterministic financial-control demonstration using simulated balances, recipients, policies, and transaction intents. The Solidity proof uses only a compact Mock INR test token and a local deterministic EVM. There is no public contract deployment, private key, mainnet transaction, custody, bank integration, stablecoin, or real-money flow.

The local contract is not a production security audit. A real-money version would require independent audit and threat modelling, applicable regulatory approvals, and integrations with licensed financial or payment partners. See [CONTRACT_ENFORCEMENT.md](CONTRACT_ENFORCEMENT.md) for controls and limitations.
