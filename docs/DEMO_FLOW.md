# 90-Second Judge Demo Flow

## 1. Normal operation
Run **Authorised payment**.

Expected: `₹1,200 → CloudGrid` is approved because the vendor, amount and task are permitted.

## 2. Independent limit enforcement
Run **Overspending attempt**.

Expected: `₹8,500` is blocked against the `₹2,500` transaction cap.

## 3. Evasion Shield
Run **Threshold splitting attack**.

Expected: four requests of `₹1,999` are clustered as one `₹7,996` attempt and blocked.

## 4. Adaptive Risk Governor
Show the engine-calculated transition from `NORMAL` through `CAUTION` to `RESTRICTED` at 55–74, where otherwise valid intents require owner approval and use a 30-second settlement delay.

## 5. In-flight revocation
Start the pending `₹1,500 → ComputeHub` payment. If the prior attack has already placed the agent in `RESTRICTED`, the canonical engine records owner approval before Phase 1. Press **Freeze Agent** before final settlement.

Expected: the intent is invalidated and `₹0` moves.

## 6. Forensic proof
Open **Forensics** and replay the engine-recorded sequence. Show the ordered rules, policy version, risk signals, owner freeze, final status, and funds-moved result.
