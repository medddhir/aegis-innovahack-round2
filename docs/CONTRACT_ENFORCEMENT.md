# Aegis Contract-Layer Enforcement

## Status and boundary

The Aegis Policy Wallet is a genuine Solidity implementation of the settlement controls that overlap with the browser risk engine. It runs in a deterministic local Hardhat EVM using **Mock INR Test Token** only.

- Environment: `LOCAL_EVM`
- Compiler: pinned `solc` 0.8.24
- Public deployment: none
- Public contract address: none
- Real funds moved: false
- Production security audit: not performed

The live website remains a simulated browser demonstration. A website click is not represented as an on-chain transaction. The contract suite is separate, executable evidence that core settlement authority is enforced outside the agent.

## Two enforcement layers

| Layer | Responsibility | Source of truth |
|---|---|---|
| Aegis Risk Engine | Behaviour signals, Evasion Shield grouping, Adaptive Risk Governor, task/category explanation, Judge Mode and forensic evidence | `public/policy-engine.js` |
| Aegis Policy Wallet | Caller roles, task hash, recipient allowlist, transaction/cumulative limits, nonce replay protection, reservations, two-phase token settlement, owner freeze and version invalidation | `contracts/src/AegisPolicyWallet.sol` |

The shared vectors in `contracts/test-vectors/aegis-vectors.json` exercise the overlapping rules against both implementations and compare normalized outcomes rather than forcing identical prose.

## Roles and authority

The deployer is the initial `OWNER`. The owner alone may:

- update the policy and authorised agent;
- approve or remove recipients;
- freeze or restore the wallet;
- cancel a pending intent and release its reservation;
- transfer ownership.

The `AGENT` may call only `requestIntent`. It cannot mutate the policy, recipient set, limits, ownership, or frozen state. The owner does not share the agent request path, so role separation is explicit in both successful and rejected calls.

## Policy wallet checks

Phase 1 accepts the recipient, amount, task hash, unique nonce, and supplied policy version. It checks:

1. caller is the authorised agent;
2. wallet is not frozen;
3. policy version is current;
4. policy is unexpired;
5. task hash matches the active Capsule;
6. recipient is approved;
7. amount is positive;
8. amount respects the per-transaction limit;
9. spent plus reserved value respects total and optional daily limits;
10. nonce has never been used;
11. the wallet has enough Mock INR test tokens for current reservations.

Success permanently consumes the nonce, reserves the amount, records `executeAfter`, stores the current policy version, and emits `IntentRequested` plus `IntentAuthorised`.

Phase 2 revalidates frozen state, policy version, task, recipient, expiry, pending status, and settlement delay before transfer. State and accounting are updated before the external token transfer, and the entry point has a simple reentrancy guard.

## Freeze and version invalidation

The kill switch avoids an unbounded loop over pending intents:

```text
Intent authorised under V1 -> PENDING
Owner freeze               -> frozen=true, policyVersion=V2
Old execute attempt         -> rejected (frozen / stale V1)
Owner restore              -> frozen=false, policyVersion=V3
Old execute attempt         -> rejected (stale V1 != V3)
Fresh V3 intent             -> may enter a new pending period
```

Restore never revives old authority. Nonces remain permanently used across freeze and restore. Reservations are version-scoped: stale reservations cannot execute or consume the active version's budget, and the owner may explicitly cancel them to release their recorded reservation.

## Mock token

`MockINRToken.sol` is a compact ERC-20-compatible test fixture with `transfer`, `approve`, and `transferFrom`. It is deliberately described as Mock INR / Test Token. It is not currency, a stablecoin, legal tender, a custody product, or a production asset.

## Run the proof

From the repository root:

```bash
npm run contract:test
npm run contract:demo
npm run contract:parity
npm run contract:proof
npm run test:all
```

`contract:proof` reads actual compiler artifacts, test results, and parity results before producing `public/contract-proof.json`. It refuses to publish a passing proof when tests or parity have failed. The normal Vercel static build does not start an EVM or compile Solidity.

## Events and rejected requests

Successful state changes emit policy, recipient, intent, settlement, cancellation, freeze, and restore events. Reverted transactions cannot retain an `IntentBlocked` event in EVM logs. The test and attack harness therefore capture custom-error names and arguments separately as the decisive rejection evidence.

## Optional future testnet deployment

No suitable testnet RPC, explicit deployer key, or funded test account was present, so this sprint intentionally remains local. A guarded script is ready but must not be run against mainnet:

```bash
cd contracts
AEGIS_TESTNET_RPC_URL="<supported-testnet-rpc>" \
AEGIS_TESTNET_DEPLOYER_KEY="<key-from-a-secure-local-secret-store>" \
AEGIS_AGENT_ADDRESS="<test-agent-address>" \
AEGIS_RECIPIENT_ADDRESS="<test-recipient-address>" \
AEGIS_CONFIRM_TESTNET_DEPLOYMENT=YES \
npm run deploy:testnet
```

Never paste a key into chat, commit it, or use a mainnet-funded account. A future public address should be added to the proof only after independent verification.

## Security review and limitations

Reviewed controls include role confusion, zero addresses, replayed nonces, stale versions, pending replay, reservation accounting, recipient removal, expiry, insufficient token balance, failed transfers, checks-effects-interactions ordering, and restore semantics.

Known boundaries:

- this is not a third-party audit or production-security certification;
- timestamp policy assumes normal EVM block-time semantics and is tested with controlled local time;
- the compact token is test infrastructure and omits production ERC-20 ecosystem concerns;
- policy updates conservatively retain lifetime `totalSpent`, so a new task policy does not silently reset prior spending;
- coordinated split-pattern recognition remains in the risk engine; the contract independently limits aggregate spent and reserved value but does not reproduce behavioural clustering;
- no proxy, governance, oracle, multisig, custody integration, or licensed payment partner is included.

Any real-money deployment would require a full independent audit, threat modelling, licensed financial/payment partners, operational controls, and applicable regulatory approvals.
