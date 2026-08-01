# Deterministic Demo Scenarios

1. **Authorised payment** — ₹1,200 to allowlisted CloudGrid passes Phase 1 and final revalidation; the displayed settled amount and trace come from the engine result.
2. **Oversized request** — ₹8,500 is blocked by the ₹2,500 per-transaction cap. The UI derives the ₹6,000 excess, failed rule, risk state, and zero funds moved from the active policy and decision.
3. **Threshold splitting** — four recorded ₹1,999 intents inside 11 seconds are clustered and blocked as one ₹7,996 evasion attempt.
4. **Adaptive restriction** — the actual before/after risk snapshots show the signals, score, state transition, and automatic restriction calculated during the attack sequence.
5. **In-flight revocation** — the actual Phase 1 result enters `PENDING_SETTLEMENT`. Judge Mode waits for the presenter to click **ACTIVATE KILL SWITCH**; a verified owner freeze advances the policy version and invalidates the intent before settlement. It is never auto-frozen. If the owner does nothing, the engine performs final revalidation when the countdown expires.
6. **Forensic proof** — Judge Mode and Attack Replay read the actual engine ledger containing the event count, selected event, intent, agent, owner, task, policy, ordered rule trace, signals, decision, owner action, settlement status, and funds moved.

Judge Mode uses the explicit lifecycle `READY`, `RUNNING`, `AWAITING_OWNER_ACTION`, `COMPLETE`, and `ERROR`. Every async callback belongs to that lifecycle and is discarded on close, reset, restart, or reopen.
