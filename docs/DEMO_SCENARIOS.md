# Deterministic Demo Scenarios

1. **Authorised payment** — ₹1,200 to allowlisted CloudGrid is approved.
2. **Oversized request** — ₹8,500 is blocked by the ₹2,500 per-transaction cap.
3. **Threshold splitting** — four requests of ₹1,999 are clustered and blocked as one ₹7,996 evasion attempt.
4. **Adaptive restriction** — calculated signals move the agent from Normal to Restricted, where valid intents require owner approval.
5. **In-flight revocation** — a valid payment is held, the owner freezes the agent, and the pending intent is invalidated before settlement.
6. **Forensic proof** — Attack Replay reads the actual engine ledger containing the intent, agent, owner, task, policy, ordered rule trace, signals, decision, owner action, settlement status, and final funds-moved result.
