# Aegis Design System

## Visual philosophy

Aegis is a calm financial-security command centre. Normal operation is quiet, structured, and blue-toned; defensive states become progressively more explicit only when the canonical engine reports risk, a block, invalidation, or freeze. The interface avoids trading-terminal density, game motifs, neon spectacle, and idle animation.

The hierarchy is designed for a projected judging screen:

1. Current scenario or operating state
2. Engine decision and transaction path
3. Decisive rule, policy version, risk state, and funds moved
4. Expandable supporting evidence

## Colour roles

| Role | Token | Meaning |
| --- | --- | --- |
| Foundation | near-black navy / graphite | product canvas and elevated surfaces |
| Structural | cool blue / cyan | navigation, policy path, active evaluation, technical information |
| Approved | emerald | passed rule, completed authorisation, valid settlement |
| Pending | amber | settlement delay, review, or owner action required |
| Restricted | orange | elevated risk and automatically tightened permissions |
| Blocked | red | failed policy rule or stopped transaction |
| Frozen | deep crimson | verified owner kill switch or revoked authority |

Red is deliberately rare. It is never used as a decorative brand accent or idle glow. Every status also has explicit text and iconography, so colour is never the sole signal.

## Typography

- Interface and narrative: local system sans-serif stack (`Inter` when already installed, then platform UI fonts).
- Evidence: local system monospace stack for policy IDs, intent IDs, rule names, timestamps, and forensic output.
- No remote font request is made.
- Interface body copy targets 15–16 px. Important controls are at least 14 px; compact evidence labels remain at least 9–12 px depending on viewport and are paired with larger values.
- Financial values use tabular numerals and preserve exact engine formatting.

## Status language

Use the engine vocabulary without optimistic reinterpretation:

- `APPROVED` / `SETTLED`
- `PENDING`
- `REQUIRE APPROVAL`
- `BLOCKED`
- `INVALIDATED`
- `FROZEN`

Every decision surface includes the decisive rule or final revalidation state, the active policy version, current risk state, and simulated funds moved where relevant. “Protected Value” is qualified as **simulated value prevented from unauthorised movement**.

## Component behaviour mapping

| Behaviour | Aegis use | Data source |
| --- | --- | --- |
| Animated Beam | Hero and Judge transaction path | current engine/Judge decision state |
| Animated List | Live intent stream | newly recorded ledger entries |
| Line Sidebar | Control Centre active view | selected interface section |
| Number transition | budget, protected value, risk, decisions, pending intents | engine snapshot values |
| Terminal reveal | selected forensic evidence | selected ledger event |
| Border glow | active Capsule and active Judge state | active UI/engine state |
| Text reveal | “The agent may be autonomous. The money never is.” | one viewport entry only |

No component fabricates activity. Empty states remain empty, and the hero is motionless until a real scenario result exists.

## Motion rules

- UI feedback: 120–250 ms.
- Panel reveal: 250–400 ms.
- Transaction motion: tied to Judge execution state; it never delays the engine.
- Freeze: one controlled red pulse.
- New event: one insertion reveal.
- Forensic evidence: one short reveal when selection changes.
- No screen shake, particles, marquee, looping typewriter, moving background, or continuous idle beam.

Under `prefers-reduced-motion: reduce`, metric values update directly, transaction beams become static state lines, and all optional reveals are removed. Timers and engine decisions remain unchanged.

## Responsive rules

- Desktop Control Centre uses a persistent vertical navigation line and five operational metrics.
- Tablet widths wrap the top status strip and reduce the metric grid without hiding owner controls.
- Mobile uses a horizontally scrollable Control Centre navigation row, a two-column status strip, one-column panels, and a full-width Freeze Agent control.
- Judge Mode uses a two-column explanation/evidence layout on desktop and a single scrollable body on mobile, with controls retained in the dialog footer.
- Forensic grids use `minmax(0, …)` and breakable evidence lines to prevent long policy traces from widening the page.

Verified viewport targets: `1440×900`, `1280×720`, `1024×768`, `768×1024`, `430×932`, `390×844`, and `360×800`.

## Accessibility boundaries

- Semantic buttons and landmark navigation are preserved.
- A skip link, visible focus rings, modal focus transfer, focus trap, Escape close, and focus restoration support keyboard operation.
- Dialog-open state makes background landmarks inert and prevents background scrolling.
- Status changes use live regions where presenter feedback is needed.
- Colour always has text and structural reinforcement.
- The interface honors reduced motion without changing values or outcomes.

## Honesty boundary

Aegis displays **SIMULATED INR**, **TEST ENVIRONMENT**, and **NO REAL FUNDS**. The proof ledger is a complete deterministic audit trail for the prototype; it is not presented as cryptographic proof. The interface does not claim bank integration, custody, regulatory approval, production readiness, customers, or real funds protected.
