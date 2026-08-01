# Aegis

**Financial guardrails for autonomous AI agents.**

Aegis is an independent financial control and kill-switch prototype built for InnovaHack Chapter 1 — Round 2, FinTech track.

- **Live prototype:** https://aegis-innovahack.vercel.app
- **Official GitHub target:** https://github.com/medddhir/aegis-innovahack-round2
- **Environment:** Simulated INR / no real funds
- **Parent company:** TurboPay Technologies Pvt. Ltd.

## Problem

Autonomous agents can request and execute financial activity faster than a human can react. Rules inside the agent are not reliable when the agent is compromised, buggy, or actively trying to bypass them.

## Solution

Aegis places an independent deterministic enforcement layer between the agent and the protected wallet. The agent requests a transaction; Aegis decides whether it is approved, held, blocked, invalidated, or frozen.

## Six locked innovations

1. **Task-Bound Budget Capsules** — funds are restricted to one task, budget, vendor set, and expiry.
2. **Adaptive Risk Governor** — permissions tighten automatically as behaviour becomes suspicious.
3. **Evasion Shield** — related small requests are clustered into one coordinated limit-evasion attempt.
4. **Two-Phase Settlement** — authorised intents are revalidated before settlement and can be revoked while pending.
5. **Policy Digital Twin** — policies are attack-tested before activation.
6. **Forensic Proof Ledger** — every decision is evidence-backed and replayable.

## Run locally

```bash
npm test
npm run build
npm run start
```

Open `http://localhost:4173`.

The browser UI and the automated tests both import the same deterministic engine from `public/policy-engine.js`. Control Centre, Judge Mode, Attack Lab, Risk Governor, Policy Digital Twin, settlement, and Forensics do not maintain separate outcome tables.

## Team

- **Medhir Lokhande** — Team Leader; product, architecture, implementation, deployment, pitch, and demo
- **Hrushikesh Lokhande** — Co-builder; QA, scenario validation, documentation, and submission verification

## Regulatory and safety boundary

This prototype uses simulated/test funds. Any production deployment involving real-money movement, custody, or operation of a payment system would require applicable regulatory approvals, security review, and integration with licensed financial or payment partners.
