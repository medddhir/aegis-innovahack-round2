# Aegis

**An independent financial firewall for autonomous AI agents.**

Aegis is an independent financial control and kill-switch prototype built for InnovaHack Chapter 1 — Round 2, FinTech track.

- **Live prototype:** https://aegis-innovahack.vercel.app
- **Official GitHub target:** https://github.com/medddhir/aegis-innovahack-round2
- **Environment:** Simulated INR / no real funds
- **Parent company:** TurboPay Technologies Pvt. Ltd.

## Problem

Autonomous agents can request and execute financial activity faster than a human can react. Rules inside the agent are not reliable when the agent is compromised, buggy, or actively trying to bypass them.

## Solution

Aegis places two independent controls between the agent and settlement. The deterministic browser risk engine explains whether a request should be approved, held, blocked, invalidated, or frozen. A genuine Solidity Policy Wallet separately enforces caller roles, task hash, allowlisted recipients, spending limits, nonce protection, pending-budget reservation, delayed settlement, and owner-controlled version invalidation using mock test tokens in a local EVM.

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
npm run contract:test
npm run contract:demo
npm run contract:parity
npm run contract:proof
npm run test:all
npm run build
npm run start
```

Open `http://localhost:4173`.

The browser UI and the automated tests both import the same deterministic engine from `public/policy-engine.js`. Control Centre, Judge Mode, Attack Lab, Risk Governor, Policy Digital Twin, settlement, and Forensics do not maintain separate outcome tables.

Judge Mode is a presentation state machine (`READY`, `RUNNING`, `AWAITING_OWNER_ACTION`, `COMPLETE`, `ERROR`) layered over that engine. It disables conflicting controls during execution, owns and clears its timers, renders the returned decision pipeline and rule trace, and requires a manual verified-owner kill-switch action for in-flight revocation. Closing, resetting, or reopening restores a deterministic and accessible demo state; reduced-motion mode changes only the animation.

## Final art direction

The public story is organized as five research chapters: **Thesis**, **Authority**, **Intervention**, **Proof**, and **The System**. It uses a restrained institutional-futurist visual language: editorial hierarchy, one connected policy instrument, one cinematic enforcement stage, one unified evidence surface, and the full-scale Control Centre. Red remains reserved for actual enforcement failure or owner revocation.

Its signature Aegis Instrument combines the agent identity, transaction, four independent policy rings, shield, decisive rule, policy version, risk state, and protected-wallet gate. A single lazy raw-WebGL ring layer progressively enhances the desktop hero; the complete SVG/CSS instrument remains the fallback for mobile, reduced-motion, low-power, context failure, and unsupported browsers. The enhancement pauses off-screen, caps device-pixel ratio, releases renderer resources, uses no external dependency, and has no decision authority.

Motion only visualises real engine state: transaction flow, policy scanning, changed metrics, new ledger entries, risk transitions, pending countdowns, owner freeze, and newly selected forensic evidence. The manual Scenario 5 kill switch closes the Core and wallet gate only after the verified owner action reaches the engine. The hero is motionless while idle, all typography uses local system fonts, and reduced-motion mode produces the same exact results without choreography.

The responsive Judge and Control Centre flows are browser-audited at `1440×900`, `1280×720`, `1024×768`, `768×1024`, `430×932`, `390×844`, and `360×800`. Final 2.5D/readability evidence is stored in [`docs/screenshots/design-v3`](docs/screenshots/design-v3/), with the earlier signature pass retained in [`docs/screenshots/design-v2`](docs/screenshots/design-v2/).

The browser/presentation suite contains **88 passing tests**, preserving the locked 72-test baseline and adding 16 focused art-direction, fallback, runtime-boundary, typography, responsive, and source-lock assertions. The isolated Hardhat suite adds **33 passing Solidity tests**, and eight shared vectors pass against both implementations. The critical browser engine, Judge runtime, visual-state mapping, Solidity policy, and pre-existing test hashes remain pinned.

## Contract enforcement proof

The contract workspace is isolated under [`contracts`](contracts/), with its own dependency lockfile and pinned compiler. `public/contract-proof.json` is generated from actual compiler artifacts, contract test output, and vector parity; the website displays that evidence as `LOCAL EVM CONTRACT SANDBOX` and explicitly says browser clicks are simulated execution rather than on-chain transactions.

Read the [contract enforcement architecture](docs/CONTRACT_ENFORCEMENT.md) and [12-scenario attack report](docs/CONTRACT_ATTACK_REPORT.md). No public contract address is claimed because no testnet deployment was performed.

## Team

- **Medhir Lokhande** — Team Leader; product, architecture, implementation, deployment, pitch, and demo
- **Hrushikesh Lokhande** — Co-builder; QA, scenario validation, documentation, and submission verification

## Regulatory and safety boundary

This prototype uses simulated/test funds. Any production deployment involving real-money movement, custody or operation of a payment system would require applicable regulatory approvals and integration with licensed financial or payment partners.
