# 90-Second Judge Demo Flow

Open **Judge Mode**. It always resets to the deterministic baseline and starts at `READY · SCENARIO 1 OF 6`. Each scenario moves through `READY → RUNNING → COMPLETE`; Scenario 5 pauses at `AWAITING_OWNER_ACTION`. While the engine is running, Previous and Next are disabled and repeated clicks cannot submit another intent.

The visual language is consistent in every scenario: cyan marks active evaluation, emerald marks a completed authorisation or settlement, amber marks a pending owner/settlement state, and red appears only at a real policy stop, invalidation, or freeze. The four-stage pipeline and textual result always remain the primary evidence; colour is supplementary. **SIMULATED FUNDS** remains visible throughout.

## 1. Normal operation
Run **Authorised payment**.

Expected: `₹1,200 → CloudGrid` passes Phase 1, passes final revalidation, and settles simulated funds. Expand **View rule trace** to show the engine-returned `rulesEvaluated` entries.

## 2. Independent limit enforcement
Run **Overspending attempt**.

Expected: `₹8,500` is blocked against the `₹2,500` transaction cap. Judge Mode shows the exact `₹6,000` excess, first failed rule, and `₹0` moved.

## 3. Evasion Shield
Run **Threshold splitting attack**.

Expected: four requests of `₹1,999` inside the recorded 11-second sequence are grouped as one `₹7,996` coordinated attempt and blocked.

The four payment cards are visually bracketed into the single combined value, while the beam stops at Aegis before the simulated wallet.

## 4. Adaptive Risk Governor
Show the engine-calculated transition from the prior state to `RESTRICTED`, including the exact signals added, calculated score, and automatic response. This panel reuses the actual risk evidence produced by the engine in the attack sequence.

## 5. In-flight revocation
Run the pending `₹1,500 → ComputeHub` payment. If the prior attack has placed the agent in `RESTRICTED`, the canonical engine records verified owner approval before the intent enters `PENDING_SETTLEMENT`. Wait for the primary button to become **ACTIVATE KILL SWITCH**, then click it manually before the countdown expires.

Expected: the verified owner freeze advances the policy version, the pending intent becomes `INVALIDATED`, the wallet is not reached, and `₹0` moves. Judge Mode never auto-freezes. If the countdown is allowed to expire, it displays the engine's real final settlement result instead. **Restart Scenario** rebuilds the deterministic prerequisite sequence.

The click produces one restrained freeze pulse. The policy path terminates before the wallet and the owner action, version transition, final status, and zero-funds result appear together.

## 6. Forensic proof
Run Scenario 6, then open **Forensics**. The scenario shows the selected ledger event ID, intent, policy version, decisive rule, owner action, final status, and funds moved. Attack Replay uses the same recorded event.

## Reset and failure safety

- **Restart Demo** clears Judge-owned timers, balances, budgets, policy state, risk state, pending intents, ledger evidence, and scenario evidence before returning to Scenario 1.
- Closing with the close button, backdrop, or Escape clears all Judge-owned timeouts and intervals, restores background scrolling, and returns focus to the launcher.
- Reopening Judge Mode starts from the same clean baseline.
- An unexpected presentation error enters `ERROR`, preserves engine and ledger evidence, and leaves **Restart Scenario** available.
- Motion only visualises returned engine state. `prefers-reduced-motion: reduce` removes the transitions without changing decisions or controls.
- At mobile widths, the scenario context, pipeline, result, and expandable trace stack inside the scrollable dialog body while the presenter controls remain reachable.
