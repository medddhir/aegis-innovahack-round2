# Aegis Design System — Institutional Futurism

## Visual philosophy

Aegis balances academic precision, financial-infrastructure restraint, and cinematic technical demonstration: approximately 70% calm authority, 20% analytical detail, and 10% impact. Normal operation is quiet, structured, and blue-toned; defensive states become progressively more explicit only when the canonical engine reports risk, a block, invalidation, or freeze. The interface avoids trading-terminal density, game motifs, neon spectacle, and idle animation.

The public experience is five chapters rather than a feature-card catalogue: Thesis, Authority, Intervention, Proof, and The System. Each viewport has one dominant idea, no more than three surface levels, no repeated trust badge, and at most one active glow.

The hierarchy is designed for a projected judging screen:

1. Current scenario or operating state
2. Engine decision and transaction path
3. Decisive rule, policy version, risk state, and funds moved
4. Expandable supporting evidence

## Signature Aegis Core

The Aegis Instrument is the system’s primary visual explanation. Four nested policy rings map to the canonical check families:

1. **Identity** — agent existence, freeze state, policy version, and nonce validity
2. **Task Intent** — Capsule task, expiry, counterparty, and category
3. **Limits** — positive amount, transaction cap, and cumulative budget
4. **Behaviour Risk** — Evasion Shield and Risk Governor

The centre shield represents the independent enforcement boundary. A neutral Core is static. During an actual evaluation the rings validate in order; an approval completes the emerald path to the simulated wallet, a block marks only the decisive ring, a pending intent pauses in amber, and invalidation closes the wallet gate. A verified owner freeze closes every ring and deactivates the path. `public/visual-state.js` performs only this result-to-presentation mapping and has no financial decision authority.

Desktop may receive one progressive raw-WebGL ring accent. It is local, lazy, bounded to the hero, paused off-screen, capped at 1.5 device-pixel ratio, and disposed on page exit or context loss. It reads visual state already produced by the locked mapping. The complete SVG/CSS object remains visible and is mandatory on mobile, reduced-motion, low-power, and failure paths.

## System state choreography

Canonical risk state changes a narrowly scoped visual perimeter: ambient edge light, the Aegis Core, top status strip, active sidebar line, transaction path, and current policy boundary. `NORMAL` is quiet navy/cyan; `CAUTION` uses amber; `RESTRICTED` orange; `QUARANTINED` violet-crimson; and `FROZEN` deep crimson. Content text and unrelated cards are never globally recoloured.

The surface system has three levels only: base canvas, operational panel, and critical active surface. Inner highlights, restrained edge reflections, and soft shadow separation provide depth without applying glass or gradients to every component.

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
- Interface body copy targets 16–18 px. Important controls are 14–16 px; critical labels are 13–15 px; decisive rules and amounts are at least 14 px; technical identifiers and regulatory copy are at least 12.5–14 px.
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
| Aegis Core rings | identity, task intent, limits, behaviour risk | decisive canonical rule and engine risk state |
| Incident scrubber | valid payment through pending invalidation | matching recorded ledger events only |
| Synchronized Twin replay | Policy V1 and Aegis V2 | same six canonical engine attack runs |

No component fabricates activity. Empty states remain empty, and the hero is motionless until a real scenario result exists.

## Motion rules

- UI feedback: 120–250 ms.
- Panel reveal: 250–400 ms.
- Transaction motion: tied to Judge execution state; it never delays the engine.
- Freeze: one controlled red pulse.
- Kill switch: an 850 ms owner pulse, Core lock, gate close, and invalidation seal after the engine response.
- New event: one insertion reveal.
- Forensic evidence: one short reveal when selection changes.
- No screen shake, particles, marquee, looping typewriter, moving background, or continuous idle beam.

Under `prefers-reduced-motion: reduce`, metric values update directly, transaction beams become static state lines, and all optional reveals are removed. Timers and engine decisions remain unchanged.

## Responsive rules

- Desktop Control Centre uses a persistent vertical navigation line and five operational metrics.
- Tablet widths wrap the top status strip and reduce the metric grid without hiding owner controls.
- Mobile uses a horizontally scrollable Control Centre navigation row, a two-column status strip, one-column panels, and a full-width Freeze Agent control.
- Judge Mode uses a three-zone theatre layout—scenario context, dominant Core, canonical proof—on desktop and a single scrollable body on mobile, with controls retained in the dialog footer.
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
