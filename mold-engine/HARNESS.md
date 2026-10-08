# MoldForge Platform — 3D Reliability Harness Specification

This file is **normative**. The words MUST / MUST NOT / SHOULD / MAY are used as in
RFC 2119. It applies to every code path that produces, accepts, transforms, or exports
geometry on the chat platform — the LLM chat layer, the 3D generator, the WebUI intake,
the mold engine driver, and the export/print-orientation stage. Any change to the
pipeline MUST keep this document's gates true, and any new stage MUST be added here
before it is added to the code.

---

## 0. Prime Directive: one gate for every producer

The platform has four untrusted producers:

| Producer | Output |
|---|---|
| The chat LLM | a design **spec** |
| The 3D generator | a **mesh** |
| The mold engine | mold **parts** (STLs) |
| The user | an uploaded **mesh** |

Rule:

- **G1.** No producer output MAY advance to the next stage directly. Every artifact
  passes the same gate regardless of who produced it.
- **G2.** The AI-generated model MUST pass the exact same server-side intake preflight
  as a stranger's upload. There is no trusted internal path.
- **G3.** Every exported STL MUST pass the same geometry checks as the master.
- **G4.** A gate verdict is one of `pass` / `warn` / `fail`, is machine-readable, and is
  recorded. Silent failure does not exist.

---

## 1. Layer 0 — Chat / LLM harnesses (before geometry exists)

These are enforced by code (schema validation), with the LLM system prompt as
reinforcement only. Never rely on the prompt alone.

- **L0.1 — Structured spec contract.** The chat model MUST emit a schema-validated JSON
  spec, never free-form text. Required fields: `target_dimensions_mm`, `product_category`,
  `material`, `casting_method`, `symmetry`, `feature_list`, `tolerance_mm`. Invalid specs
  get exactly one repair round-trip, then a user-facing rejection.
- **L0.2 — Ask, don't guess.** If size, material, or casting method is unknown, the bot
  MUST ask the user. A wax master with a guessed size is geometrically valid and fails
  at casting time — the most expensive place to fail.
- **L0.3 — Plausibility clamping.** Per-category dimension ranges (ring vs. figurine vs.
  tray) MUST be defined in code. Out-of-range LLM values are clamped and surfaced for
  confirmation, never accepted raw.
- **L0.4 — Moldability classifier.** Ideas that cannot be molded MUST be rejected at
  chat time with a reason: articulated multi-part bodies, sealed internal voids without
  escape holes, features thinner than the minimum wall for the medium.
- **L0.5 — Millimeters only.** The contract `1 Blender unit = 1 mm` holds from first
  byte to final export. Unit-bearing strings ("2 inch", "3cm") MUST be resolved to mm at
  the chat boundary and never appear past it.

---

## 2. Layer 1 — Mesh intake gate

### 2.1 Already enforced — keep, do not weaken

Existing in `webui/server.py` (intake) and `webui/safety/` (preflight, hooks):

- Extension whitelist `.stl/.obj/.ply/.glb/.gltf`; upload cap 200 MB.
- Hard rejects: non-finite vertices, extent > 20 000 mm, faces > 4 000 000
  (`safety/preflight.py` `enforce()`, limits in `safety/limits.py`).
- Reported: non-manifold edges, boundary edges, watertight flag, connected-component
  count, self-intersection warning (≤ 150k faces).
- Runtime guards on every modifier application: exploded-coordinate guard (|coord| >
  100 000 mm), NaN check, 1500-op budget, recovery-ladder no-progress detection,
  memory/time watchdog, kill supervisor (`safety/hooks.py`, `safety/guards.py`).
- 250k-face auto-remesh threshold mirrored between engine and client adviser.

### 2.2 Required additions

- **L1.1 — Server-side unit normalization.** Today no unit auto-detection exists; a
  centimeter-scaled file sails through. Heuristic MUST be added: if overall extent falls
  in implausible cm/m ranges for the category while the spec says mm, rescale uniformly
  or demand confirmation. Never non-uniform scale.
- **L1.2 — Single-shell rule as a server hard reject.** Separate-cluster detection
  currently lives only client-side (`adviser.js`). A client can be bypassed. The server
  MUST reject multi-component meshes with a dedicated error code (the known
  "separate pieces" failure class).
- **L1.3 — Magic-byte sniffing.** Extension whitelist alone cannot defend against a
  renamed or hostile file. Sniff binary/ASCII STL headers, validate GLB chunk structure;
  explicitly handle or reject ASCII STL.
- **L1.4 — Spec-vs-mesh dimensional audit.** The bounding box of the generated mesh
  MUST be compared to the spec's `target_dimensions_mm` within `tolerance_mm`; apply
  uniform rescale or regenerate. The 3–20 cm slider is a user control, not this check.

---

## 3. Layer 2 — Manufacturability gates

These reject geometry that is *topologically valid* but impossible to mold or cast.
None of these exist today. Ship each as **advisory + heatmap** first; promote to
blocking per-gate once telemetry shows the gate is stable.

- **L2.1 — Minimum wall thickness.** Voxel- or ray-based thickness analysis with a
  user-facing heatmap. Thin features below the medium's limit (≈ 0.8 mm for wax) are the
  single most likely next failure class: AI generators systematically emit delicate
  thin-walled jewelry.
- **L2.2 — Enclosed-void detection.** Sealed internal cavities trap silicone/air and
  are fatal to this pipeline; the current undercut proxy sees only open pockets.
  Detection: fully-enclosed shells inside the convex hull.
- **L2.3 — Minimum hole / pin diameter.** Blind holes narrower than the medium allows
  must be flagged with a "widen or add escape hole" remediation.
- **L2.4 — Draft angle in degrees.** The ray-crossing trapped-pocket fraction is a
  proxy; complement it with per-face degree measurement against the mold parting
  direction. Advisory — legitimate jewelry undercuts are handled by multi-part molds.
- **L2.5 — Spike/needle detection.** High-aspect protrusions that tear on demolding.
  The existing BVH from print orientation can serve this.
- **L2.6 — Shrinkage compensation.** Once material is confirmed, apply the casting
  shrink factor (silver ≈ 2%, brass ≈ 1.5%) to master dimensions as an explicit, logged
  stage with the factor visible in the report.
- **L2.7 — Bed-fit enforcement.** `fits_ref_bed` in `print_orientation.py` is currently
  advisory and oversized parts still export. Promote to a hard gate with a remediation
  (re-orient, split part, or explicit rejection).

---

## 4. Layer 3 — Output gates

- **L3.1 — Post-build re-validation.** Exported STLs are not re-checked today.
  Boolean ops and orientation baking can break manifoldness and watertightness. The
  full `inspect()` + enforcement cycle MUST run on every exported part. This is cheap:
  the code already exists, it is one more call.
- **L3.2 — Output-vs-spec dimensional audit.** Bounding box and volume of every
  exported part compared against the original LLM spec (after shrinkage compensation).
  This is where spec-to-part drift becomes visible.
- **L3.3 — Print-orientation as a gate.** `print_orientation.py` scoring is a report
  today. If any part fails its acceptance score, the part ships with a visible cause or
  does not ship — never a silent bad STL.

---

## 5. Layer 4 — Process & runtime harnesses

Existing runtime armor is mature and MUST be preserved: op budgets, recovery ladder,
explode/NaN sentinels, kill supervisor, quarantine for dangerous codes, structured
error codes. Additions:

- **L4.1 — Repair budget.** Auto-repairs (junk-island removal, heal, remesh, trim) are
  monitored but have no per-job attempt cap. After N repair attempts the job MUST stop
  with an actionable error code. No job may ping-pong for minutes hoping — a public
  user cannot diagnose a zombie server.
- **L4.2 — Adversarial regression corpus.** Alongside the sane input library, a corpus
  of every failure class a public generator will emit: non-manifold, wrong scale
  (cm/inch), junk islands, 2M-face sculpts, NaN coordinates, inside-out (negative
  volume), open holes, enclosed voids, needle spikes. Every engine change runs it.
- **L4.3 — Topology fuzzing.** Complement `tools/po_stress.py` timing stress with a
  bad-property generator that injects failure properties at controlled rates. Overnight
  runs reveal gate flakiness faster than manual analysis.
- **L4.4 — Per-gate telemetry.** `preflight.json`, `stages.jsonl`, `result.json`
  already exist; aggregate pass/warn/auto-repaired rates **per gate** into a dashboard.
  These numbers identify the flakiest gate, the most-used auto-repair, and whether the
  generator is improving. This is the product metric of a chat platform.
- **L4.5 — Versioned pipeline + content-hash caching.** Engine version, prompt version,
  and spec content hash recorded in every result; identical hashes reuse computed
  results. Behavior becomes attributable, replayable, and A/B-testable.

---

## 6. Always-enforced invariants (the constitution)

Every stage, every job, no exceptions:

1. `1 unit = 1 mm`, everywhere, always.
2. Exactly one closed, watertight, manifold shell — before and after every boolean.
3. Only uniform rescaling, and only with a visible reason; never silent non-uniform scale.
4. Every stage emits a machine-readable pass/warn/fail; silent failure does not exist.
5. Repair has a budget and a report; infinite repair does not exist.
6. Every output is re-validated as an input (G3).
7. Blocked manufacturability failures carry a human-readable cause and remediation.
8. Advisory vs. blocking is an explicit, documented list per gate — never a guess.
9. Quarantined files are kept, never deleted.
10. Everything is logged: stage, content hash, versions, durations, gate verdicts.

---

## 7. Build priority

Given intake and runtime are already strong, implement in this order:

| # | Harness | Layer | Why first |
|---|---|---|---|
| 1 | Minimum wall thickness analysis | L2.1 | Most likely real-world failure of AI-generated masters |
| 2 | Enclosed-void detection | L2.2 | Fatal to silicone/investment molding, invisible to current checks |
| 3 | Post-build re-validation of exports | L3.1 | Cheapest to add — existing code, one more call |
| 4 | Server-side unit normalization | L1.1 | Silent wrong-scale is a guaranteed public-launch incident |
| 5 | Single-shell server reject + magic bytes | L1.2/L1.3 | Closes client-side-only enforcement and intake spoofing |
| 6 | Spec↔mesh↔output dimensional audits | L1.4/L3.2 | Closes the loop from chat intent to physical part |
| 7 | Bed-fit enforcement, print gate | L2.7/L3.3 | Stops exporting unprintable parts |
| 8 | Repair budget, telemetry, fuzzing, corpus | L4.x | Operational hardening once gates exist |
