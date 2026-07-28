# Pre-Implementation Report: Milestone 7.2 — Label Candidate Generation and Scoring

**Date:** 2026-07-28
**Status:** Pre-implementation documentation only — no code written
**Authoritative baseline:** `e9f3a7d5cb71a4a48872b624d6337b40b0672f29` (Milestone 7.1 approved)

---

## 1. Milestone Identification

| Field | Value |
|---|---|
| **Specification name** | Milestone 7 — Labels (part 2) |
| **Repo numbering** | Milestone 7.2 |
| **Build Order position** | 7 of 11 |
| **Pipeline stage** | Stage 9 — Place Labels |
| **Module** | `core/labels/` |

---

## 2. Source Documents and Headings

| # | Document | Code | Heading / Section | Key Content |
|---|---|---|---|---|
| 1 | Build Order (Implementation Plan) | LCS-IMP-002 | "Milestone 7 — Labels" | "Implement real Arabic text measurement and **label candidate solver**." |
| 2 | Canonical Pipeline (Project Architecture) | LCS-ARC-002 | "Stage 9 — Place Labels" | "Measure and place labels." |
| 3 | Label Candidate Generation (Layout and Labels) | LCS-LBL-002 | Full document | 6 candidate families, `LabelCandidate` interface, scoring preferences, terminal person rule |
| 4 | Label Solver (Layout and Labels) | LCS-LBL-003 | Full document | Ordered assignment with backtracking, hard rules, unresolved reason exposure |
| 5 | Label and Stability Contracts (Engine Contracts) | LCS-CON-005 | Full document | `TextMeasurementService`, `LabelLayoutEngine`, `IncrementalLayoutEngine`, `ConstraintManager` |
| 6 | Bible: Label Layout Engine (Release 3) | LNGP-R3-06 | Full document (10 sections) | Label types, candidate zones, association, hard/soft constraints, terminal labels |
| 7 | End-to-End Solve Pseudocode (Algorithms) | LCS-ALG-001 | Full pseudocode | `labels = LabelLayoutEngine.place(skeleton, graph)` |
| 8 | Decision Priority (Governance) | LCS-GOV-002 | Priority #3, Hard vs Soft | Collision avoidance priority 3; readable labels are a hard constraint |
| 9 | Acceptance Gates (Testing and Benchmarks) | LCS-TST-005 | "Gate 4 — Labels" | "Zero overlaps and minimum readability satisfied." |
| 10 | Text Measurement (Layout and Labels) | LCS-LBL-001 | Full document | Inputs, outputs, prohibition of character-count approximation |

---

## 3. Authoritative Requirements from Specification

### 3.1 Candidate Families (LCS-LBL-002)

The specification defines six candidate families:

- **Aligned with branch** — label placed directly on the branch centerline near the person's anchor, rotated to match branch tangent
- **Offset above branch** — label placed above the branch, with leader connection
- **Offset below branch** — label placed below the branch, with leader connection
- **Lateral** — label placed to the side of the branch, typically with a longer leader
- **Terminal leaf** — label for persons without descendants, MAY be larger than ordinary branch labels but MUST remain within boundary and collision rules
- **Cartouche zone** — decorative zone supplied by template/configuration data; candidate geometry cannot be generated without zone coordinates

### 3.2 Candidate Interface (LCS-LBL-002)

```ts
interface LabelCandidate {
  personId: PersonId;
  bounds: Bounds;
  anchor: Vec2;
  rotation: number;
  leaderLength: number;
  class: string;
}
```

### 3.3 Scoring Preferences (LCS-LBL-002)

The specification lists these preferences (in authoritative order):

1. No collision
2. Short anchor distance
3. Low rotation
4. Consistent local rhythm
5. Stable prior location
6. Adequate branch clearance

### 3.4 Hard Rules for Labels (LCS-LBL-003, LCS-GOV-002, LNGP-R3-06)

These are pass/fail constraints:

- No overlap between labels
- Minimum font size (`LabelConfig.minimumFontSize`)
- Complete text visibility (no clipping)
- Correct person association
- No crossing leader lines
- No branch-label penetration (measured distance < label clearance)
- Boundary containment (full collision envelope must remain inside template)
- Labels must follow RTL/BiDi correctly

### 3.5 Terminal Person Rule (LCS-LBL-002)

> "A terminal leaf label MAY be larger than ordinary branch labels but MUST remain within boundary and collision rules."

**Terminal-person detection** MUST use the `GenealogyGraph` child relationships (persons with zero children), not merely the absence of a skeleton branch. A person with no children in the genealogy graph gets terminal leaf candidates regardless of branch presence.

### 3.6 Solver Output (LCS-LBL-003)

> "The solver MUST expose unresolved candidate reasons."

This is a Milestone 7.3 requirement, but the reason types are already defined in the M7.1 types (`UnresolvedReasonCode`).

---

## 4. Proposed Defaults Requiring Approval (not authoritative)

The specification does not define numerical weights, candidate counts, or exact geometry parameters. The following defaults are proposed and require stakeholder approval before implementation.

### 4.1 Scoring weights

| Term | Proposed default weight | Notes |
|---|---|---|
| No collision | 0.35 | Hard constraint first; soft weight used only for ranking valid candidates |
| Short anchor distance | 0.25 | Normalised to `1 - min(anchorDistance / maxAcceptableDistance, 1.0)` |
| Low rotation | 0.15 | Normalised to `1 - abs(rotation) / config.maximumRotationDegrees` |
| Consistent local rhythm | 0.10 | Normalised to `1 - varianceOfNeighborRotations / maxAcceptableVariance` |
| Stable prior location | *(deferred to M8 — Stability)* | Removed from M7.2 scoring |
| Adequate branch clearance | 0.15 | Normalised to `1 - max(0, requiredClearance - actualDistance) / requiredClearance` |

All weights sum to 1.0. Each sub-score is in [0, 1].

### 4.2 Candidate count per person

Proposed: generate 4 families (aligned, above, below, lateral) for all persons, plus terminal leaf for childless persons. Cartouche zone is generated only when explicit zone geometry is present. Each family produces 1–2 variants. Average ≈ 6 candidates per person.

### 4.3 Terminal leaf size multiplier

Proposed: new `LabelConfig.terminalLabelScale` field (default 1.2) applied to the font size for terminal persons.

### 4.4 Anchor distance maximum

Proposed: `maxAcceptableDistance = max(branchLength * 0.3, 50)` — a candidate whose anchor is more than 30% of the branch length or 50 units from the endpoint is scored 0 (but retained for potential use in the solver's backtracking phase).

---

## 5. Candidate Generation

### 5.1 Generation inputs

| Input | Source | Description |
|---|---|---|
| `SkeletonPlan` | M3 — Skeleton Growth | Approved skeleton with branches, nodes, curves, thickness |
| `SkeletonBranchMap` | M3 — computed | Map from branch ID to `SkeletonBranch` |
| `GenealogyGraph` | M1/M2 — Import | Person data including names and **child relationships** (for terminal-person detection) |
| `LabelConfig` | M1 — Configuration | `minimumFontSize`, `maximumRotationDegrees` |
| `TextMeasurementService` | M7.1 — Text Measurement | `measure(request)` returns `TextMetricsResult` |
| `CandidateCollisionQuery` (see §5.3) | M4.2 — Collision Safety | Read-only abstraction for testing a candidate against fixed obstacles |
| `CollisionConfig` | M1 — Configuration | `branchClearance`, `labelClearance`, `barkAllowance` |
| `TemplateBoundary` | M2 — Territory | Outer boundary for containment testing |
| `CartoucheZone[]` | *(optional, from config/template)* | Predefined cartouche zones; empty array if none configured |

### 5.2 Generation algorithm (per person)

For each person `p` in the skeleton who has a branch `b`:

1. **Detect terminality**: `graph.getChildren(p.id).length === 0` → terminal person
2. **Measure name**: call `textMeasurementService.measure(nameRequest)` once per person with the configured font, size, and direction (result cached in TypographyCache)
3. **Locate anchor**: `anchor = b.endPoint` (branch endpoint)
4. **Compute tangent**: `tangent = cubicBezierTangent(b.curve, t=1)`, then `angle = atan2(tangent.y, tangent.x) * 180 / PI`
5. **Clamp rotation**: `rotation = clamp(angle, -maximumRotationDegrees, +maximumRotationDegrees)`
6. **Generate per family** (see §5.5): produce `LabelCandidate` objects with positioned bounds, anchor, rotation, leader length, and family label
7. **Validate each candidate** against fixed obstacles: branch envelopes, boundaries, already-fixed placements (but NOT against other candidates — that is M7.3's responsibility)

### 5.3 CandidateCollisionQuery (read-only abstraction)

Instead of putting the concrete `CollisionIndex` into serializable DTOs or `SolveContext`, define a read-only query abstraction:

```ts
interface CandidateCollisionQuery {
  /** Returns true if the given bounds overlap any fixed obstacle
   *  (branch envelope, boundary, or already-placed label). */
  overlapsFixedObstacle(bounds: Bounds, excludeAnchor?: Vec2, anchorRadius?: number): boolean;

  /** Returns the minimum clearance between the given point and
   *  any fixed branch envelope. Used for leader-line validation. */
  minClearanceToFixedObstacles(point: Vec2): number;
}
```

This abstraction:
- Keeps collision internals out of serializable types
- Can be implemented by wrapping the existing `CollisionIndex`
- Supports the self-anchor exemption (see §5.4)

### 5.4 Self-anchor exemption

A label or leader that attaches at its own anchor MUST NOT be rejected for overlapping that exact anchor point.

The `overlapsFixedObstacle()` method accepts `excludeAnchor` and `anchorRadius` parameters. When checking a candidate:
- The spherical region around `(anchor, anchorRadius)` is excluded from branch-envelope collision testing
- All geometry outside this attachment zone remains subject to full collision clearance

Default `anchorRadius`: `max(branchThickness.baseThickness, 8)` — ensuring the label can attach at the branch endpoint without being falsely rejected.

### 5.5 Candidate families — generation rules

| Family | Generated when | Position logic | Leader | Cartouche zone required? |
|---|---|---|---|---|
| Aligned with branch | Always | Bounds centered on `endPoint`, rotated by clamped tangent angle | `leaderLength: 0` | No |
| Offset above branch | Always | Bounds shifted perpendicularly above branch at `endPoint` | Euclidean distance | No |
| Offset below branch | Always | Bounds shifted perpendicularly below branch at `endPoint` | Euclidean distance | No |
| Lateral | Always | Bounds shifted to lateral side (configurable left/right preference) | Euclidean distance | No |
| Terminal leaf | Only if `graph.getChildren(p.id).length === 0` | Same as aligned, with optional size multiplier | `leaderLength: 0` | No |
| Cartouche zone | Only if cartouche zone coordinates are supplied in config/template | Bounds placed within the nearest compatible zone | Varies | Yes |

### 5.6 Collision scope for candidate generation

Candidate generation validates against **fixed obstacles only**:
- Branch envelopes (from M4.2 `CollisionIndex`)
- Template boundary
- Already-fixed label placements (if available, e.g., trunk labels placed before branch labels)

Candidate-to-candidate conflicts (e.g., "this label would overlap that label") are the responsibility of **Milestone 7.3 (Label Solver)**, which runs the full ordered assignment with backtracking. The generator does not attempt to resolve placement conflicts.

---

## 6. Scoring

### 6.1 Valid vs. invalid candidates

Each candidate carries a **validation status** and optional **rejection reasons**. This is separate from the numerical score:

```ts
interface LabelCandidate {
  // … fields from LCS-LBL-002 …
  readonly validationStatus: "VALID" | "INVALID";
  readonly rejectionReasons: readonly string[];
  readonly score: number | null;   // null if INVALID, [0,1] if VALID
}
```

- **VALID**: passes all hard constraints. Receives a composite score. Included in the ranked valid set.
- **INVALID**: fails one or more hard constraints. `score` is `null`. Excluded from the ranked valid set. The solver may still reference invalid candidates for diagnostics or backtracking context.

### 6.2 Hard constraints that produce INVALID status

- Branch-label penetration (measured distance < branchClearance, excluding the self-anchor zone)
- Boundary violation (bounds or leader point outside template)
- Minimum font size violated
- Text clipping (glyph overflow)
- Rotation exceeds `maximumRotationDegrees`
- Leader line crosses a branch envelope
- Label overlaps an already-placed label (when such placements exist)

### 6.3 Hard constraints that produce a score penalty

- Insufficient branch clearance (clearance deficit ≤ 30%): candidate remains VALID but receives a lower score
- Excessive anchor distance: candidate remains VALID but receives a lower score

### 6.4 Soft preferences (scoring terms)

See §4.1 for proposed weights. The composite score is:

```
score = w_collision * s_collision
      + w_distance * s_distance
      + w_rotation * s_rotation
      + w_rhythm   * s_rhythm
      + w_clear    * s_clearance
```

Where weights are as proposed in §4.1 (pending approval). Prior-location scoring is deferred to Milestone 8 — Stability.

### 6.5 Deterministic tie-breaking

When two candidates have equal composite scores, the candidate with the **lower person ID** (lexicographic comparison) receives the higher rank. This makes the scorer fully deterministic regardless of input order.

---

## 7. Integration with Completed Milestones

| Milestone | Integration point | Use |
|---|---|---|
| M2 — Genealogy | `GenealogyGraph.getChildren()` | Terminal-person detection |
| M2 — Territory | `TemplateBoundary` | Boundary containment |
| M3 — Skeleton | `SkeletonBranch.curve`, `.endPoint`, `.thickness` | Anchor, tangent, offset distance |
| M4.1 — Routing | `RoutingRecord.corridorPolygon` | Additional obstacle for label placement |
| M4.2 — Collision | `CollisionIndex.query()` | Branch-envelope query (wrapped by `CandidateCollisionQuery`) |
| M4.2 — Collision | `CollisionConfig.labelClearance` | Clearance threshold |
| M7.1 — Text Measurement | `TextMeasurementService.measure()` | Label bounds from actual glyph metrics |
| M7.1 — Determinism | `TypographyCache` | Cached, repeatable measurement |
| LCS-GOV-002 | Decision Priority #3 | Collision avoidance > readability > visual beauty |

---

## 8. Expected Files to Create

| File | Purpose |
|---|---|
| `src/core/labels/CandidateCollisionQuery.ts` | Read-only collision query abstraction (wraps `CollisionIndex`) |
| `src/core/labels/LabelCandidateGenerator.ts` | Generate `LabelCandidate[]` per person: compute anchor, tangent, offset positions, measure text, build per-family candidates |
| `src/core/labels/LabelCandidateScorer.ts` | Score VALID candidates using weighted formula; separate VALID from INVALID |
| `tests/unit/labels/LabelCandidateGenerator.test.ts` | Unit tests |
| `tests/unit/labels/LabelCandidateScorer.test.ts` | Unit tests |
| `tests/unit/labels/CandidateCollisionQuery.test.ts` | Unit tests including self-anchor exemption |

### 8.1 Modified files (types only)

| File | Change |
|---|---|
| `src/core/labels/types.ts` | Add `LabelCandidateGenerationInput`; add `validationStatus` and `rejectionReasons` to `LabelCandidate` |

### 8.2 No modifications to

- `src/core/collision/` — the existing API is sufficient; wrapped by `CandidateCollisionQuery`
- `src/core/skeleton/` — existing types provide all needed data
- `src/core/routing/` — corridor data is consumed, not modified
- `src/core/labels/TextMeasurer.ts` — already finalized in M7.1

---

## 9. Explicit Out-of-Scope Items

- ❌ Full label placement with backtracking (Milestone 7.3)
- ❌ Label-to-label conflict resolution (Milestone 7.3)
- ❌ Final validation (`LabelValidator` — Milestone 7.3)
- ❌ Prior-location stability scoring (Milestone 8)
- ❌ Incremental layout / stability (Milestone 8)
- ❌ Bark, leaves, visual themes (Milestone 10)
- ❌ SVG/PNG/PDF export, cartouche rendering (Milestone 11)
- ❌ UI components

---

## 10. Acceptance Criteria

| Criterion | Source | Verification |
|---|---|---|
| Each skeleton person receives at least one VALID candidate | LCS-LBL-002 | Unit test per person type |
| Candidates include measured `Bounds` from `TextMeasurementService` | LCS-LBL-002, LCS-LBL-001 | Assert bounds width/height match measured metrics |
| Terminal persons get terminal leaf candidates | LCS-LBL-002 | Test with `GenealogyGraph` children |
| INVALID status for hard-constraint violations | LCS-GOV-002 | Unit test with known-overlapping candidate |
| Self-anchor exemption prevents false rejection | §5.4 | Unit test: candidate at anchor is VALID |
| `CandidateCollisionQuery` never mutates collision index | §5.3 | Read-only abstraction, no mutation methods |
| Scoring is deterministic (same input → same scores) | LCS-TST-005, Gate 6 | Property test with repeat runs |
| All existing 307 tests continue to pass | LCS-GOV-001 | Full regression suite |

---

## 11. Unresolved Ambiguities (with recommended decisions)

### 11.1 Self-anchor exemption radius

**Cited:** The specification does not define an attachment zone exemption.

**Recommended:** `anchorRadius = max(branchThickness.baseThickness, 8)`. This ensures the label can attach at the branch endpoint without false rejection for touching its own branch.

### 11.2 Offset distance for above/below candidates

**Cited:** LCS-LBL-002 says "offset above branch" but does not quantify the offset.

**Recommended:** Perpendicular offset = `max(branchThickness.baseThickness + labelClearance, 12)`. This places the label outside the branch's collision envelope.

### 11.3 Lateral preference direction

**Cited:** The spec does not specify left vs. right preference for lateral candidates.

**Recommended:** Generate both lateral-left and lateral-right candidates. The scorer selects the better one based on collision and distance.

### 11.4 Cartouche zone data source

**Cited:** LCS-LBL-002 mentions the family; no specification defines where zone geometry comes from.

**Recommended:** Cartouche zone geometry is supplied by the template/configuration data as an optional set of `{ zoneId: string; polygon: Polygon; labelAnchor: Vec2 }` entries. If none are configured, zero cartouche candidates are generated. Implementation of the zone data source is deferred to the template configuration milestone, but the generator's contract supports it.

### 11.5 Leader line as collision shape

**Cited:** LCS-LBL-003 says "no crossing leader lines" (hard rule).

**Recommended:** Leaders are validated as thin line segments (width ≈ 1) against branch envelopes, other leaders, and label bounds. A leader that crosses any fixed obstacle produces an INVALID candidate.

---

## 12. Approved Decisions Required Before Implementation

The following choices are recommended but not authoritative in the specification. Each requires stakeholder approval:

| # | Decision | Recommended | Alternative |
|---|---|---|---|
| D1 | Scoring weights | 0.35 collision, 0.25 distance, 0.15 rotation, 0.10 rhythm, 0.15 clearance | Equal weights (0.20 each) |
| D2 | Candidate count | 4 families, ~6 per person average | All 5 families, ~10 per person |
| D3 | Terminal leaf scale | `LabelConfig.terminalLabelScale` = 1.2 | Fixed font size increase (e.g., +2px) |
| D4 | Max anchor distance | `max(branchLength * 0.3, 50)` | Fixed value (e.g., 100) |
| D5 | Self-anchor radius | `max(branchThickness.baseThickness, 8)` | Fixed value (e.g., 10) |
| D6 | Offset distance | `max(branchThickness.baseThickness + labelClearance, 12)` | Fixed value (e.g., 20) |
| D7 | Invalid-candidate representation | `validationStatus: "VALID" | "INVALID"` with `score: null` | `score: -1` sentinel value |
| D8 | Prior-location scoring | Deferred to M8 | Implement in M7.2 with weight 0.0 |
| D9 | Cartouche zone generation | Only when zone geometry is supplied | Generate from trunk-base zone automatically |
| D10 | `CandidateCollisionQuery` interface | Read-only query with `excludeAnchor` param | Accept `CollisionIndex` directly in `SolveContext` |

---

## 13. Recommended Implementation Order

1. Define `CandidateCollisionQuery` abstraction (wrap `CollisionIndex`)
2. Extend `LabelCandidate` type with `validationStatus` and `rejectionReasons`
3. Implement `LabelCandidateGenerator`:
   - Terminal-person detection via `GenealogyGraph.getChildren()`
   - Text measurement (one call per person, cached)
   - Per-family position computation (tangent → angle → offset → bounds)
   - Self-anchor exemption
4. Implement `LabelCandidateScorer`:
   - Hard-constraint validation → VALID/INVALID
   - Composite weighted score
   - Deterministic tie-breaking
5. Unit tests for each module
6. Verify all existing 307 tests pass

---

*This report is documentation-only. No production code, tests, schemas, or dependencies have been added. No Milestone 7.1 files have been modified.*
