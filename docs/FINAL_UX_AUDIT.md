# Final UX Audit

Baseline: `f43e7d3`  
Scope: presentation orchestration only. Existing product copy, engine state, financial evidence, Judge Mode, Red Team Lab, Solidity enforcement, and parity are locked.

## Cross-product findings

- The header, zone controls, persistent status treatments, animated component surfaces, and chapter headings often compete at the same visual weight. Navigation needs one current-chapter signal and a quieter reading-progress rail.
- Several sections reveal the heading, supporting copy, controls, evidence, and ambient component behaviours simultaneously. Entries need a short hierarchy: heading, explanation, then the operational surface.
- The page shifts abruptly between marketing-scale chapters, dense product UI, attack theatre, proof panels, and the network illustration. Shared chapter transitions and bounded scale reveals can make these feel like one system without rewriting content.
- Dense evidence is technically useful but visually immediate. Existing `details` disclosures should carry full traces, payloads, and hashes while decisive evidence stays visible.
- Motion ownership is distributed among CSS behaviours. Scroll orchestration must not compete with engine-driven state motion and must pause whenever a full-screen operational overlay opens.
- Mobile currently stacks content correctly, but desktop-oriented density and component depth persist too long. Mobile should receive short entry reveals only: no pinning, scrubbing, perspective, or hidden critical actions.

## Section audit

### Navigation and hero

- Primary navigation does not communicate the reader's current chapter or total progress strongly enough.
- Hero content is clear, but every element remains equally present until it leaves the viewport. A restrained departure should quiet supporting content and compress the Aegis Instrument while retaining CTA availability.
- The thesis reveal and proof values should remain legible; they should not inherit character-by-character or repeated fade effects.

### Threat

- The scan surface, grid, chapter statement, and component motion arrive together. The thesis should establish the problem first, followed by the scan field.
- Grid Scan already communicates analysis; no additional ambient motion belongs here.

### Authority

- The Stepper, Option Wheel, orbiting policy domains, policy document, and risk spectrum compete within one view.
- The existing five authority steps should become the narrative spine. Scroll may change visual emphasis only; it must never activate policy or record evidence.
- The right-hand operational policy surface is the useful sticky focus on desktop. Mobile should present the same steps in source order without pinning.

### Intervention

- Attack controls, scenario sequence, Core, beams, cluster, outcome, and explanatory text are visible concurrently.
- The existing scenario items already contain the required causal sequence. A single bounded presentation timeline should focus one stage at a time without running engine requests.
- The live controls must remain interactive outside scroll choreography, with a direct skip path and a clear distinction between explanatory projection and live Judge/Red Team execution.

### Control Centre

- The product is nested inside a large chapter frame, then contains sidebar, top status, metrics, panels, quick dock, and mobile dock. The entry should move from contained frame to flat operational surface, then stop transforming completely.
- Metrics and stream items should reveal in one brief hierarchy; interactive controls must never remain tilted or disabled after the entrance.

### Challenge and Red Team Lab

- The lab itself is well structured but visually dense on first open: presets, inputs, advanced controls, policy configuration, instrument, trace, contract context, ledger, and summary share one screen.
- Default inputs and primary action must remain visible. Advanced controls and complete evidence already have appropriate disclosure boundaries.
- Entry should focus the preset/amount path and preserve native modal scrolling, values, countdowns, focus trap, and owner action.

### Proof, Digital Twin, and Forensics

- Digital Twin, forensic evidence, contract proof, hashes, test totals, Lightfall, terminal, and ledger all seek attention.
- The proof chapter needs one vertical path: browser engine, decision, contract wallet, local verification, test funds. Existing proof labels must be reused exactly.
- The Twin comparison can receive synchronized visual progress, but scrolling must never execute its attack suite.
- Forensics should default to selected incident, decisive rule, policy version, outcome, funds, and owner action. Complete traces, payloads, and hashes belong behind existing disclosures.

### Policy network, team, and regulatory boundary

- The network visual is already explicitly illustrative; it should enter as a quiet system epilogue rather than another high-motion centrepiece.
- Team, source, and regulatory copy must remain stable, immediately readable, and unanimated beyond a simple section entry.

## Elements that must not animate

- Transaction outcomes, financial values after engine return, countdown timing, rule-trace scrolling, legal/regulatory language, source hashes, form inputs while focused, modal focus traps, and owner-action controls.
- Any scroll-only presentation state must remain class- and attribute-based, reversible or final-state safe, and incapable of writing to engine or ledger state.
