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

The browser UI and the automated tests both import the same deterministic engine from `public/policy-engine.js`. Control Centre, Judge Mode, Attack Lab, Red Team Lab, Risk Governor, Policy Digital Twin, settlement, and Forensics do not maintain separate outcome tables.

Judge Mode is a presentation state machine (`READY`, `RUNNING`, `AWAITING_OWNER_ACTION`, `COMPLETE`, `ERROR`) layered over that engine. It disables conflicting controls during execution, owns and clears its timers, renders the returned decision pipeline and rule trace, and requires a manual verified-owner kill-switch action for in-flight revocation. Closing, resetting, or reopening restores a deterministic and accessible demo state; reduced-motion mode changes only the animation.

## Judge vs Aegis — Red Team Lab

**Red Team Lab** is a full-screen defensive adversarial transaction simulator available from Attack Theatre, the Control Centre quick actions, and the completed Judge Mode flow. A judge can enter any paise-safe simulated amount, choose an approved or custom recipient, select the authorised or an incorrect task, replay a nonce, submit a stale policy version, coordinate up to ten requests, or activate a fresh owner-defined test policy. Presets populate those controls; they never determine the result.

Every attempt runs through a new isolated instance of the same canonical `AegisPolicyEngine`. Single intents use the normal intent path, coordinated requests use the real batch/Evasion Shield path, and pending requests use the normal two-phase settlement path. A pending custom request settles if left alone or becomes `INVALIDATED` only after the judge manually activates the owner Kill Switch. The pipeline, decisive rule, risk evidence, ledger, session totals, and funds moved are rendered from returned engine evidence.

The Lab remains explicitly bounded: it uses simulated INR and does not execute arbitrary clicks on-chain. Its contract panel says that core settlement boundaries are independently implemented and verified by the local-EVM Aegis Policy Wallet suite; it does not show fake transaction hashes or a fake public address.

## Black Label interface

The Black Label public experience distributes 32 locally implemented component behaviours across eight purpose-built zones: Hero, Threat Scan, Authority Builder, Control Centre, Attack Theatre, Proof Lab, Illustrative Policy Network, and Judge Mode. They are integrations rather than a gallery: the scan runs a real intent, live lists read the ledger, numbers use proof or engine values, and the beam, Core, terminal, and owner controls animate only returned state.

Its signature Aegis Instrument combines the agent identity, transaction, four independent policy rings, shield, decisive rule, policy version, risk state, and protected-wallet gate. One local raw-WebGL ring enhancement is permitted on capable desktops; the complete SVG/CSS instrument remains the fallback for mobile, reduced motion, low power, context failure, and unsupported browsers. Rendering pauses off-screen and has no decision authority.

**Command Mode** is the default graphite/cobalt operational theme. The optional persistent **Research Mode** uses warm ivory, ink, and technical blue without changing system state. Compact typography caps the desktop hero at 50 px and section headings at 40 px. Red remains reserved for a real block, elevated risk, invalidation, or verified owner freeze.

Run `npm run component:audit` to validate the complete component catalogue, visible DOM locations, animation budgets, mobile strategy, and reduced-motion strategy. The responsive browser audit covers `1440×900`, `1280×720`, `1024×768`, `768×1024`, `430×932`, `390×844`, and `360×800`; the 21-view Black Label evidence and contact sheet are in [`docs/screenshots/black-label`](docs/screenshots/black-label/).

The browser/presentation suite contains **136 passing tests**. The isolated Hardhat suite contains **33 passing Solidity tests**, and eight shared vectors pass against both implementations. The critical browser engine, Judge runtime, visual-state mapping, Solidity policy, and pre-existing test hashes remain pinned.

## Contract enforcement proof

The contract workspace is isolated under [`contracts`](contracts/), with its own dependency lockfile and pinned compiler. `public/contract-proof.json` is generated from actual compiler artifacts, contract test output, and vector parity; the website displays that evidence as `LOCAL EVM CONTRACT SANDBOX` and explicitly says browser clicks are simulated execution rather than on-chain transactions.

Read the [contract enforcement architecture](docs/CONTRACT_ENFORCEMENT.md) and [12-scenario attack report](docs/CONTRACT_ATTACK_REPORT.md). No public contract address is claimed because no testnet deployment was performed.

## Team

- **Medhir Lokhande** — Team Leader; product, architecture, implementation, deployment, pitch, and demo
- **Hrushikesh Lokhande** — Co-builder; QA, scenario validation, documentation, and submission verification

## Regulatory and safety boundary

This prototype uses simulated/test funds. Any production deployment involving real-money movement, custody or operation of a payment system would require applicable regulatory approvals and integration with licensed financial or payment partners.
