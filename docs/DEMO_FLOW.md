# 90-Second Judge Demo Flow

Open **Judge Mode**. It always resets to the deterministic baseline and starts at `READY · SCENARIO 1 OF 6`. Each scenario moves through `READY → RUNNING → COMPLETE`; Scenario 5 pauses at `AWAITING_OWNER_ACTION`. While the engine is running, Previous and Next are disabled and repeated clicks cannot submit another intent.

For a short prelude, use **Threat Scan** to submit the oversized intent through the canonical engine, then move to **Authority Builder** to show how task, budget, counterparties, expiry, and activation form one Capsule. **Run Full Attack Suite** advances the real interface scenarios only as far as the pending transaction; it intentionally cannot activate the owner Kill Switch. Command/Research theme selection is presentational and persists locally.

For an unscripted challenge, select **Try to Break Aegis** in Attack Theatre or **Red Team** in the Control Centre quick actions. Judge Mode also exposes **Try to Break Aegis** after Scenario 6 reaches `COMPLETE`. All three entry points open the same full-screen **Judge vs Aegis — Red Team Lab**.

The visual language is consistent in every scenario: cyan marks active evaluation, emerald marks a completed authorisation or settlement, amber marks a pending owner/settlement state, and red appears only at a real policy stop, invalidation, or freeze. The central Aegis Core shows four independent rings—Identity, Task Intent, Limits, and Behaviour Risk—and selects the exact ring associated with the decisive engine rule. The four-stage pipeline and textual result always remain the primary evidence; colour is supplementary. **SIMULATED FUNDS** remains visible throughout.

The compact **CONTRACT-BACKED RULE PARITY** badge is supporting evidence, not a claim that the live click is on-chain. Expand it to show the generated contract test count, eight-vector parity result, `LOCAL EVM` environment, and source link. The badge states that Judge Mode uses simulated browser execution while core settlement controls are independently implemented in Solidity.

## 1. Normal operation
Run **Authorised payment**.

Expected: `₹1,200 → CloudGrid` passes Phase 1, passes final revalidation, and settles simulated funds. Expand **View rule trace** to show the engine-returned `rulesEvaluated` entries.

## 2. Independent limit enforcement
Run **Overspending attempt**.

Expected: `₹8,500` is blocked against the `₹2,500` transaction cap. Judge Mode shows the exact `₹6,000` excess, first failed rule, and `₹0` moved.

## 3. Evasion Shield
Run **Threshold splitting attack**.

Expected: four requests of `₹1,999` inside the recorded 11-second sequence are grouped as one `₹7,996` coordinated attempt and blocked.

The four real intent cards converge through relation lines into one `COORDINATED ATTEMPT · ₹7,996 · 11-SECOND WINDOW` verdict, while the Behaviour Risk ring stops the beam before the simulated wallet.

## 4. Adaptive Risk Governor
Show the engine-calculated transition from the prior state to `RESTRICTED`, including the exact signals added, calculated score, and automatic response. This panel reuses the actual risk evidence produced by the engine in the attack sequence.

## 5. In-flight revocation
Run the pending `₹1,500 → ComputeHub` payment. If the prior attack has placed the agent in `RESTRICTED`, the canonical engine records verified owner approval before the intent enters `PENDING_SETTLEMENT`. Wait for the primary button to become **ACTIVATE KILL SWITCH**, then click it manually before the countdown expires.

Expected: the verified owner freeze advances the policy version, the pending intent becomes `INVALIDATED`, the wallet is not reached, and `₹0` moves. Judge Mode never auto-freezes. If the countdown is allowed to expire, it displays the engine's real final settlement result instead. **Restart Scenario** rebuilds the deterministic prerequisite sequence.

After the engine responds, the click produces one restrained owner-to-Core pulse. The rings lock, the wallet gate closes, the pending beam terminates, and the result states `FINANCIAL AUTHORITY REVOKED`, `PENDING INTENT INVALIDATED`, and `FUNDS MOVED: ₹0`. The owner action, V4→V5 transition, and final status remain visible together.

## 6. Forensic proof
Run Scenario 6, then open **Forensics**. The incident scrubber selects available ledger-backed stages from valid payment through pending invalidation; unavailable stages remain explicitly unrecorded. The terminal shows the selected event ID, intent, policy version, decisive rule, owner action, final status, and funds moved. It makes no cryptographic-proof claim.

## Optional live challenge — Red Team Lab

Start with the default **Policy-Compliant Payment**, change the amount to `₹2,499`, and submit. If the recipient, task, version, and nonce remain valid, the canonical engine approves and settles it. Replay with `₹2,501`; the same engine blocks it at `PER_TRANSACTION_LIMIT` and reports the exact excess with `₹0` moved. This proves that the preset label is not the outcome source.

Then select **Threshold Splitting**. The Lab submits four related `₹1,999` intents through the coordinated batch path, displays their combined attempted value and recorded window, and renders the real `EVASION_SHIELD` decision. For a policy challenge, expand **Define a fresh test policy**, complete the five owner-control steps, and activate it; subsequent results use those newly activated canonical policy values.

Finish with **Pending Payment + Kill Switch**. Phase 1 produces a real `PENDING_SETTLEMENT` intent and exposes the countdown plus **ACTIVATE KILL SWITCH**. Click it manually to record the owner freeze, increment the policy version, invalidate the pending intent, and retain `₹0` moved. If no freeze occurs, the Lab calls real final revalidation when the timer expires and shows the settlement result instead.

The right-hand evidence column provides the actual rule trace, risk signals, ledger events, session totals, and verified local-EVM contract boundary. **Reset Lab** clears the isolated session. **Replay Last Attempt** rebuilds that session under the same active test policy and reproduces deterministic evidence. On mobile, the primary action remains sticky while the inputs, instrument, and evidence stack vertically.

## Reset and failure safety

- **Restart Demo** clears Judge-owned timers, balances, budgets, policy state, risk state, pending intents, ledger evidence, and scenario evidence before returning to Scenario 1.
- Closing with the close button, backdrop, or Escape clears all Judge-owned timeouts and intervals, restores background scrolling, and returns focus to the launcher.
- Reopening Judge Mode starts from the same clean baseline.
- An unexpected presentation error enters `ERROR`, preserves engine and ledger evidence, and leaves **Restart Scenario** available.
- Motion only visualises returned engine state. `prefers-reduced-motion: reduce` removes the transitions without changing decisions or controls.
- At mobile widths, the scenario context, pipeline, result, and expandable trace stack inside the scrollable dialog body while the presenter controls remain reachable.

## Contract proof handoff

After Judge Mode, scroll to Chapter 4, **Enforced twice. Explained once.** Its unified proof surface presents the engine-derived Policy Digital Twin, the latest actual ledger evidence, and the Solidity Policy Wallet together. Contract values are loaded from `contract-proof.json`: the actual passing test count, vector parity, local environment, and `REAL FUNDS MOVED: FALSE`. Full source and bytecode hashes stay behind **View complete technical evidence** so the default view remains readable.

The adjacent **Illustrative Test Network** is an architecture diagram only. Mumbai, Singapore, London, New York, and Seoul are synthetic policy nodes; the section explicitly states that there are no live payment rails, customers, deployments, or regulatory-coverage claims.
