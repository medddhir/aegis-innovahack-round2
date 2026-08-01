# Aegis Policy Wallet Attack Report

## Execution summary

The executable harness at `contracts/scripts/run-aegis-attack-suite.js` ran twelve scenarios against fresh local Hardhat deployments with separate owner, agent, recipient, attacker, and unknown-recipient identities.

- Asset: Mock INR Test Token (`mINR-TEST`)
- Environment: `LOCAL_EVM`
- Real funds: false
- Scenarios recorded: 12/12
- Contract tests: 33 passed, 0 failed
- Shared parity: 8/8 passed

Run it with:

```bash
npm run contract:demo
```

The complete machine-readable output is generated locally at `contracts/attack-report.json` and is intentionally ignored by Git because it is reproducible build/test output.

## Recorded scenarios

| # | Request | Contract result | Decisive contract evidence | Mock funds moved |
|---:|---|---|---|---:|
| 1 | Valid allowlisted ₹1,000 payment | `SETTLED` | Phase 1 checks and Phase 2 revalidation passed | ₹1,000 |
| 2 | ₹2,501 against ₹2,500 limit | `BLOCKED` | `PerTransactionLimitExceeded(2501, 2500)` | ₹0 |
| 3 | Unknown recipient | `BLOCKED` | `RecipientNotApproved` | ₹0 |
| 4 | Wrong task hash | `BLOCKED` | `TaskMismatch` | ₹0 |
| 5 | Request after Capsule expiry | `BLOCKED` | `PolicyExpired` | ₹0 |
| 6 | Exact and changed-amount nonce reuse | `BLOCKED` | `NonceAlreadyUsed` for both retries | ₹0 |
| 7 | ₹1 request after ₹5,000 reserved | `BLOCKED` | `TotalBudgetExceeded(5001, 5000)` | ₹0 |
| 8 | Four requests of ₹1,999 | first two pending; later requests blocked | `DailyLimitExceeded` after ₹3,998 was reserved | ₹0 |
| 9 | Pending ₹1,200 then owner freeze | `INVALIDATED` | `WalletIsFrozen`; version advanced V1→V2 | ₹0 |
| 10 | Agent calls restore | `BLOCKED` | `UnauthorizedOwner` | ₹0 |
| 11 | Old V1 intent after owner restore to V3 | `INVALIDATED` | `StalePolicyVersion(1, 3)` | ₹0 |
| 12 | Fresh V3 request after restore | `SETTLED` | current version, fresh nonce, final revalidation | ₹1,000 |

Scenario 8 documents the layer boundary honestly. Evasion Shield in the browser risk engine recognizes the four related requests as one coordinated ₹7,996 behavioural attack. The Solidity wallet does not claim behavioural clustering; it independently prevents the requests from over-reserving the configured daily/total Capsule budget.

## Shared parity result

The following vectors were executed against the canonical browser engine and a deployed local contract instance:

```text
PASS approved-payment       SETTLED     / SETTLED
PASS oversized-payment      BLOCKED     / BLOCKED
PASS unknown-recipient      BLOCKED     / BLOCKED
PASS wrong-task             BLOCKED     / BLOCKED
PASS cumulative-limit       BLOCKED     / BLOCKED
PASS duplicate-nonce        BLOCKED     / BLOCKED
PASS pending-freeze         INVALIDATED / INVALIDATED
PASS stale-version          BLOCKED     / BLOCKED
```

Parity compares normalized outcomes and rule categories. Environment-specific revert prose and browser explanations are preserved rather than artificially made identical.

## Freeze proof

The pending intent is created under V1 and reserves its amount. Owner `freeze()` advances the policy to V2, so new requests fail and the old intent cannot execute. Owner `restore()` advances again to V3. The old V1 intent remains stale and its nonce remains consumed; only a new V3 intent with a fresh nonce may settle. No completed transaction is described as reversed.

## Evidence limits

This report proves deterministic local execution of the checked source and tests. It is not a public-chain deployment record, cryptographic attestation, penetration test, formal verification, third-party audit, or statement of production readiness.
