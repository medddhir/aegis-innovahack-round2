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

## Locked innovations

1. Task-Bound Budget Capsules
2. Adaptive Risk Governor
3. Evasion Shield
4. Two-Phase Settlement with In-Flight Revocation
5. Policy Digital Twin
6. Forensic Proof Ledger and Attack Replay

## Prototype boundary

The system is a deterministic financial-control demonstration using simulated balances, recipients, policies, and transaction intents. A production real-money version would require security review, applicable regulatory approvals, and integrations with licensed financial or payment partners.
