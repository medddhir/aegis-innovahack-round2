# Deterministic Demo Scenarios

1. **Authorised payment** — ₹1,200 to allowlisted CloudGrid is approved.
2. **Oversized request** — ₹8,500 is blocked by the ₹2,500 per-transaction cap.
3. **Threshold splitting** — four requests of ₹1,999 are clustered and blocked as one ₹7,996 evasion attempt.
4. **Adaptive restriction** — repeated violations move the agent from Normal to Restricted.
5. **In-flight revocation** — a valid payment is held, the owner freezes the agent, and the pending intent is invalidated before settlement.
6. **Forensic proof** — the attack is replayed with the agent, policy, signals, decision, and final funds-moved result.
