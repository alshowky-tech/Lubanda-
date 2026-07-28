# Pre-Implementation Report: Milestone 7 — Labels

**Date:** 2026-07-28
**Status:** Pre-implementation documentation only — no code written
**Authoritative baseline:** `bf0fce5a4366e01b8a6a88635178f87d95bce4b9` (Milestone 4.2 — Collision Safety approved)

---

## 1. Milestone Identification

| Field | Value |
|---|---|
| **Specification name** | Milestone 7 — Labels |
| **Repo numbering** | Milestone 7 |
| **Build Order position** | 7 of 11 |
| **Pipeline stage** | Stage 9 — Place Labels |
| **Phase (Bible)** | Phase 3 — Labels and Stability |
| **Module** | `core/labels/` |
| **Implementation Sequence step** | Step 9 — Labels |
| **First 90-Day Plan** | Days 61–75 |

---

## 2. Source Documents and Headings

| # | Document | Code | Heading / Section | Key Content |
|---|---|---|---|---|
| 1 | Build Order (Implementation Plan) | LCS-IMP-002 | "Milestone 7 — Labels" | *"Implement real Arabic text measurement and label candidate solver."* |
| 2 | Canonical Pipeline (Project Architecture) | LCS-ARC-002 | "Stage 9 — Place Labels" | *"Measure and place labels."* |
| 3 | Module Map (Project Architecture) | LCS-ARC-001 | "2. Dependency Direction" | `collision ──► labels`, `skeleton ───► labels` |
| 4 | Label and Stability Contracts (Engine Contracts) | LCS-CON-005 | Full document | `TextMeasurementService`, `LabelLayoutEngine`, `IncrementalLayoutEngine`, `ConstraintManager` interfaces |
| 5 | Text Measurement (Layout and Labels) | LCS-LBL-001 | Full document | Inputs, outputs, Arabic shaping, RTL, determinism, cache, prohibition of character-count sizing |
| 6 | Label Candidate Generation (Layout and Labels) | LCS-LBL-002 | Full document | Candidate families, `LabelCandidate` interface, scoring preferences, terminal leaf rules |
| 7 | Label Solver (Layout and Labels) | LCS-LBL-003 | Full document | Ordered assignment with backtracking, hard rules, unresolved reason exposure |
| 8 | Canopy Utilization (Layout and Labels) | LCS-LAY-004 | Full document | Occupied area ratio, empty region distribution, lineage density variance, re-layout prohibition |
| 9 | Bible: Label Layout Engine (Release 3) | LNGP-R3-06 | Full document (10 sections) | Label types, measurement, candidates, association, hard/soft constraints, terminal labels, search, export |
| 10 | Bible: Normalization and Arabic Text (Release 2) | LNGP-R2-04 | Full document (10 sections) | Unicode normalization, Arabic shaping, RTL, mixed-direction, numerals, font independence, bidi safety |
| 11 | End-to-End Solve Pseudocode (Algorithms) | LCS-ALG-001 | Full pseudocode | `labels = LabelLayoutEngine.place(skeleton, graph)` — labels placed after collision resolution, before relaxation |
| 12 | Decision Priority (Governance) | LCS-GOV-002 | Priority #3 | Collision avoidance is priority 3; readable labels are a hard constraint |
| 13 | Acceptance Gates (Testing and Benchmarks) | LCS-TST-005 | "Gate 4 — Labels" | *"Zero overlaps and minimum readability satisfied."* |
| 14 | First 90-Day Plan (Implementation Plan) | LCS-IMP-003 | "Days 61–75" | *"Arabic text measurement, label placement, incremental layout, branch movement constraints."* |
| 15 | Bible: Implementation Sequence (Release 5) | LNGP-R5-12 | "Step 9 — Labels" | *"Measure and place Arabic labels."* |

---

## 3. Required Contracts and Types

### 3.1 `TextMeasurementService` (from LCS-CON-005)

```ts
interface TextMeasurementService {
  measure(request: TextMeasureRequest): TextMetricsResult;
}
```

### 3.2 `LabelLayoutEngine` (from LCS-CON-005)

```ts
interface LabelLayoutEngine {
  place(input: LabelLayoutInput, ctx: SolveContext): LabelLayoutResult;
}
```

### 3.3 `LabelCandidate` (from LCS-LBL-002)

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

### 3.4 Additional types to define

| Type | Description | Source |
|---|---|---|
| `TextMeasureRequest` | text, font family, font size, font weight, letter spacing, direction, maximum width, line count policy | LCS-LBL-001 |
| `TextMetricsResult` | width, height, baseline, line boxes, glyph overflow | LCS-LBL-001 |
| `LabelPlacement` | Placed label with position, rotation, bounds, person ID, font | LCS-CON-005 |
| `LabelLayoutInput` | skeleton, graph, configuration, collision index (for validation) | LCS-CON-005, LCS-ALG-001 |
| `LabelLayoutResult` | accepted/rejected with label placements, collisions, metrics | LCS-CON-005 |
| `LabelConfig` (exists) | `minimumFontSize`, `maximumRotationDegrees` | `src/core/config/types.ts` |

### 3.5 Label types (from LNGP-R3-06 §2)

- Wood label (trunk-associated)
- Branch label (mid-branch person)
- Terminal leaf label (person without descendants)
- Decorative cartouche (special zones)
- Free text element (custom annotations)

### 3.6 Candidate families (from LCS-LBL-002)

- Aligned with branch
- Offset above branch
- Offset below branch
- Lateral
- Terminal leaf
- Cartouche zone

---

## 4. Arabic Text Measurement Requirements

### 4.1 Mandatory features (LCS-LBL-001, LNGP-R2-04)

1. **Arabic shaping support** — characters must render in correct initial/medial/final/isolated forms
2. **RTL and mixed-direction testing** — bidirectional text must be tested in canvas, SVG, PNG, PDF, print
3. **Deterministic measurement** — same typography request must produce identical metrics for export determinism
4. **Fallback font policy** — when a font lacks a glyph, a configured fallback must be used without breaking metrics
5. **Cache keyed by full typography request** — measurement results should be cached by (text, font, size, weight, spacing, direction, maxWidth, lineCountPolicy)
6. **Approximate character-count sizing MUST NOT be used for final placement** (LCS-LBL-001 — Prohibition)

### 4.2 Arabic text considerations (LNGP-R2-04)

| Requirement | Detail |
|---|---|
| Right-to-left direction | Labels must flow RTL by default for Arabic text |
| Arabic shaping | Initial, medial, final, isolated forms depend on context |
| Mixed Arabic and Latin IDs | IDs may contain both scripts |
| Arabic and Western numerals | Both digit forms must be supported |
| Diacritics | Tashkeel and other diacritical marks must be preserved |
| Honorific policies | Configurable display rules for repeated honorifics |
| Search normalization | Alef variants, ya/alef maqsura, optional diacritics, tatweel, whitespace — must not modify stored canonical names |
| Unicode normalization | NFC/NFD consistent, original text preserved separately |
| Font independence | Data model stores text, not font outlines; fonts belong to presentation layer |
| Bidirectional safety | Mixed RTL/LTR content must be validated in all output formats |

### 4.3 Measurement implementation strategy

**Key challenge:** Node.js/TypeScript does not have a native text shaping engine. Options:

| Option | Description | Consequences |
|---|---|---|
| **A — Canvas-based measurement (node-canvas)** | Use `node-canvas` with a HarfBuzz-backed text measuring API. Provides real Arabic shaping. | ✅ Real Arabic shaping; ✅ RTL support; ❌ External native dependency; ❌ Slower than pure JS; ❌ Complex CI setup |
| **B — Pure JS measurement with estimated metrics** | Measure using character-width tables for Arabic + Latin. | ❌ No real shaping; ❌ Violates LCS-LBL-001 prohibition; ✅ No native deps |
| **C — Web API measurement via jsdom** | Use jsdom + OffscreenCanvas for measurement. | ❌ jsdom has limited font shaping; ❌ Unreliable for Arabic |
| **D — fontkit + opentype.js** | Load fonts and measure glyph advances programmatically. | ✅ Pure JS; ✅ Real glyph metrics; ❌ Full shaping (contextual forms) requires additional logic; ✅ No native deps |

---

## 5. Label Candidate Generation and Scoring

### 5.1 Generation per person (LCS-LBL-002)

For each person in the skeleton:
1. Determine person's branch endpoint (from `SkeletonBranch.endPoint`)
2. Generate candidates for the **families**:
   - **Aligned with branch**: label on the branch centerline near the endpoint, rotated to match branch tangent
   - **Offset above branch**: label above the branch segment
   - **Offset below branch**: label below the branch segment
   - **Lateral**: label to the side of the branch
   - **Terminal leaf** (if person has no children): label near the terminal node with optional leaf frame
   - **Cartouche zone** (if configured): label inside a decorative zone

### 5.2 Candidate parameters

Each candidate includes:
- `personId: PersonId` — associated person
- `bounds: Bounds` — measured text bounding box after rotation
- `anchor: Vec2` — attachment point on the branch
- `rotation: number` — rotation in degrees (bounded by config `maximumRotationDegrees`)
- `leaderLength: number` — length of leader line (0 if label touches branch)
- `class: string` — candidate family name

### 5.3 Scoring (LCS-LBL-002)

Prefer (in order):
1. **No collision** — label does not overlap any branch, other label, or boundary
2. **Short anchor distance** — label close to the person's branch endpoint
3. **Low rotation** — minimal rotation from horizontal
4. **Consistent local rhythm** — labels in a region should have consistent orientation
5. **Stable prior location** — if a prior layout exists, prefer the previous label position
6. **Adequate branch clearance** — labels must respect minimum clearance with branches

### 5.4 Terminal person rule (LCS-LBL-002)

> "A terminal leaf label MAY be larger than ordinary branch labels but MUST remain within boundary and collision rules."

---

## 6. Label Solver Algorithm

### 6.1 Strategy (LCS-LBL-003)

```
sort labels by difficulty:
    fewest candidates,
    largest area,
    highest local density,
    stable prior label first

for label in labels:
    choose best non-colliding candidate
    if none:
        backtrack local assignments
    if still none:
        request local geometry relaxation
    if still none:
        fail with LABEL_PLACEMENT_IMPOSSIBLE
```

### 6.2 Hard rules (LCS-LBL-003)

- No overlap (label–label, label–branch, label–boundary)
- Minimum font size (from `LabelConfig.minimumFontSize`)
- Complete text visibility (no clipping)
- Correct person association
- No crossing leader lines

### 6.3 Output requirement (LCS-LBL-003)

> "The solver MUST expose unresolved candidate reasons."

### 6.4 Collision integration (from approved M4.2 types)

The existing `CollisionEngine` already includes these collision classes relevant to labels:
- `"BRANCH_LABEL"` — branch collides with label
- `"LABEL_LABEL"` — label collides with another label
- `"LABEL_BOUNDARY"` — label exceeds boundary

The `CollisionPolicy` already includes `labelClearance` in `CollisionConfig` (value: 6).

The `CollisionIndex` accepts an optional `labels?: readonly LabelPlacement[]` parameter (per LCS-CON-004), making it ready to accept label placements for collision testing once labels are implemented.

---

## 7. RTL and Multiline Behavior

### 7.1 RTL requirements

- Arabic text labels MUST flow right-to-left by default
- Mixed RTL/LTR content (e.g., Arabic name + Latin ID) requires bidi reordering
- Measurement must account for the correct visual order after bidi reordering
- Rotation transforms must preserve RTL flow direction

### 7.2 Multiline requirements

- Labels exceeding `maximumWidth` must wrap to multiple lines
- Line wrapping must respect Arabic word boundaries
- `lineCountPolicy` controls whether the measurement returns the natural number of lines or truncates at a maximum
- `line boxes` in `TextMetricsResult` provide per-line geometry for collision testing

### 7.3 Bidirectional safety (LNGP-R2-04 §8)

Mixed-direction labels must be tested in:
- Web canvas
- SVG
- PNG export
- PDF export
- Print

(For this milestone, only the measurement and placement are implemented; the export formats are tested in Milestones 10–11.)

---

## 8. Determinism Requirements

| Requirement | Source | Implementation |
|---|---|---|
| Deterministic measurement | LCS-LBL-001 | Same typography request → identical metrics. Cache keyed by full request. |
| Deterministic ranking | LCS-LBL-003 | Sort by difficulty with stable tie-breaking (person ID). |
| Deterministic backtracking | LCS-LBL-003 | Backtracking order must be deterministic; use ordered candidate lists. |
| Deterministic placement | LCS-CON-005 | Repeated runs with same inputs → identical LabelLayoutResult. |
| Deterministic fingerprint | M4.1 pattern | The layout result should include a SHA-256 fingerprint of canonical JSON. |
| No random variation in scoring | LCS-LBL-002 | Scoring weights must be deterministic; any pseudo-random element must use `stableUnit()` from `core/determinism/`. |
| Floating-point rounding | Existing pattern | Positions and rotations rounded to 6 decimal places. |

---

## 9. Expected Files to Create or Modify

### 9.1 New files (core module)

| File | Purpose |
|---|---|
| `src/core/labels/types.ts` | `TextMeasureRequest`, `TextMetricsResult`, `LabelPlacement`, `LabelCandidate`, `LabelLayoutInput`, `LabelLayoutResult`, `LabelLayoutMetrics` |
| `src/core/labels/TextMeasurementService.ts` | Interface + implementation for real text measurement (delegates to canvas/fontkit) |
| `src/core/labels/TextMeasurer.ts` | Actual measurement implementation with Arabic shaping support |
| `src/core/labels/LabelCandidateGenerator.ts` | Generate candidate positions per person based on branch geometry |
| `src/core/labels/LabelCandidateScorer.ts` | Score and rank candidates per scoring preferences |
| `src/core/labels/LabelSolver.ts` | Ordered assignment with backtracking per LCS-LBL-003 |
| `src/core/labels/LabelLayoutEngine.ts` | `LabelLayoutEngine` interface implementation: `place()` |
| `src/core/labels/LabelValidator.ts` | Validate labels against hard rules (no overlap, minimum size, etc.) |
| `src/core/labels/LabelDiagnostics.ts` | Diagnostic events for label placement stages |
| `src/core/labels/index.ts` | Barrel exports |
| `src/core/labels/cache.ts` | Typography measurement cache (Map keyed by full request) |
| `schemas/label-layout-result.schema.json` | Schema for serializable label layout result |

### 9.2 New files (tests)

| File | Purpose |
|---|---|
| `tests/unit/labels/TextMeasurementService.test.ts` | Measurement tests with Arabic and Latin text |
| `tests/unit/labels/LabelCandidateGenerator.test.ts` | Candidate generation for each family |
| `tests/unit/labels/LabelCandidateScorer.test.ts` | Scoring and ranking |
| `tests/unit/labels/LabelSolver.test.ts` | Solver with collision checking |
| `tests/unit/labels/LabelValidator.test.ts` | Hard rule validation |
| `tests/property/labels.property.test.ts` | Determinism, no overlap, valid metrics |
| `tests/integration/skeleton-to-labels.test.ts` | Skeleton → Collision → Labels → Validation |
| `tests/integration/collision-labels.test.ts` | Collision index with label placements |

### 9.3 Modified files

| File | Change |
|---|---|
| `src/index.ts` | Add `export * from "./core/labels/index.js"` |
| `src/core/contracts/solve-stage.ts` | Add `MILESTONE_7_STAGES` (MEASURE_TEXT, GENERATE_CANDIDATES, SCORE_CANDIDATES, SOLVE_LABELS, VALIDATE_LABELS) |
| `src/core/contracts/issues.ts` | Add `LABEL_ISSUE_CODES` |
| `src/core/contracts/identifiers.ts` | Add `LabelPlacementId` brand type if needed |
| `src/core/collision/types.ts` | Extend `CollisionInput` to accept label placements; extend `CollisionIndex` to support label queries |
| `schemas/error-codes.schema.json` | Add label issue codes and M7 stages |
| `configs/default-engine-configuration.json` | Update label config if new fields are added |

### 9.4 Documentation files

| File | Purpose |
|---|---|
| `docs/architecture/milestone-7-architecture.md` | Architecture document |
| `docs/traceability/milestone-7-matrix.md` | Traceability matrix |

---

## 10. Explicit Out-of-Scope Items

The following are NOT part of this milestone and MUST NOT be implemented:

- ❌ Incremental reflow or prior-layout constraints (Milestone 8 — Stability)
- ❌ Web Workers or checkpointing (Milestone 9 — Scale)
- ❌ Bark rendering, leaves (visual), themes, templates (Milestone 10 — Visual Layer)
- ❌ SVG/PNG/PDF export or production UI (Milestone 11 — Export and Production UI)
- ❌ AI style analysis or AI-assisted label placement (deferred)
- ❌ UI components of any kind
- ❌ Interactive label dragging/repositioning (UI concern)
- ❌ Print-specific formatting or outline conversion
- ❌ Changing genealogy, import, validation, geometry primitives, spatial hash, demand, territory, skeleton growth, routing, or collision logic (completed milestones — preserve their behavior)
- ❌ Decorative cartouche rendering (visual ornament; candidate generation only for placement)
- ❌ Font file management or font upload UI
- ❌ Search normalization beyond what already exists (LNGP-R2-04 §5 — already implemented in Milestone 2)

---

## 11. Acceptance Criteria and Required Tests

### 11.1 Quality gates

| Gate | Source | Verification |
|---|---|---|
| Gate 4 — Labels: Zero overlaps and minimum readability satisfied | LCS-TST-005 | Automated label validation tests |
| Gate 3 — Geometry: Zero forbidden crossings (preserved) | LCS-TST-005 | Collision integration tests extended |
| Gate 6 — Determinism: Repeated fixed-seed runs serialize identically | LCS-TST-005 | Property test with byte-identical comparison |
| Hard constraint: readable labels | LCS-GOV-002 | LabelValidator test suite |
| Solver exposes unresolved candidate reasons | LCS-LBL-003 | Solver output inspection |
| No character-count approximation for final placement | LCS-LBL-001 | Measure test with actual typography |

### 11.2 Required tests

| Test area | Count (minimum) | Coverage |
|---|---|---|
| Text Measurement (Arabic) | 8+ | Arabic shaping, RTL, mixed-direction, Latin fallback, diacritics, multi-line wrap, cache hit/miss, determinism |
| Text Measurement (Latin) | 4+ | Basic text, mixed numbers, rotation, max width |
| Candidate Generation | 10+ | All 6 families, edge cases (terminal, root, deep branches), boundary clipping |
| Candidate Scoring | 6+ | Score ordering, tie-breaking, prior-layout preference, clearance preference |
| Label Solver | 12+ | Simple placement, collision avoidance, backtracking, impossible placement, determinism, no crossing leaders |
| Collision Integration | 4+ | Index with labels, branch-label collision, label-label collision, label-boundary |
| Property Tests | 4+ | Deterministic replay, no overlap in accepted layouts, valid metric ranges, fingerprint stability |
| Integration | 3+ | Skeleton → Labels, Skeleton → Collision → Labels, Full pipeline |

---

## 12. Compatibility Requirements with Approved Collision Safety Baseline

### 12.1 Already existing (no changes needed)

| Feature | Location | Status |
|---|---|---|
| `CollisionConfig.labelClearance` (value: 6) | `src/core/config/types.ts` | ✅ Ready |
| `LabelConfig.minimumFontSize` (value: 12) | `src/core/config/types.ts` | ✅ Ready |
| `LabelConfig.maximumRotationDegrees` (value: 20) | `src/core/config/types.ts` | ✅ Ready |
| `"BRANCH_LABEL"` collision class | `src/core/collision/types.ts` | ✅ Ready |
| `"LABEL_LABEL"` collision class | `src/core/collision/types.ts` | ✅ Ready |
| `"LABEL_BOUNDARY"` collision class | `src/core/collision/types.ts` | ✅ Ready |
| `"MOVE_LABEL"` resolution scope | `src/core/collision/types.ts` | ✅ Ready |
| Dependency direction `collision ──► labels` | LCS-ARC-001 | ✅ Architecture confirmed |

### 12.2 Modification needed

| Change | Reason |
|---|---|
| Extend `CollisionIndex.query()` to support label bounds | Labels need to test against branch envelopes and other labels |
| Extend `CollisionEngine.index()` to accept `labels?: readonly LabelPlacement[]` | Per LCS-CON-004, optional label parameter already declared but not implemented |
| Extend `ConstraintSolver` to test branch–label and label–label collisions | Currently only tests branch–branch, self, and boundary |
| Update `CollisionInput` or create `LabelLayoutInput` that includes collision data | Labels stage runs after collision resolution; needs access to collision index |

### 12.3 Preserved invariants

- Collision Safety (M4.2) tests must continue to pass: **207 tests, 0 regressions**
- `CollisionEngine` public API must remain backward-compatible
- No existing function signature may change — only overloads or optional parameters may be added

---

## 13. Unresolved Ambiguities (with options, consequences, and recommendations)

### 13.1 Text measurement implementation: native dependency vs. pure JS

**Cited requirements:**
- LCS-LBL-001: "Arabic shaping support," "RTL and mixed-direction testing," "deterministic measurement for export"
- LCS-LBL-001 Prohibition: "Approximate character-count sizing MUST NOT be used for final placement"
- LNGP-R2-04: "The platform must support right-to-left direction, Arabic shaping"

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — fontkit + opentype.js** (recommended) | Load the configured Arabic font via `fontkit` or `opentype.js`, compute glyph advances and positions using the font's GSUB/GPOS tables for Arabic shaping. Cache results by full typography request. | ✅ Pure JavaScript; ✅ Real Arabic glyph metrics; ✅ No native binary dependencies; ✅ Works in all JS runtimes; ❌ Full Arabic shaping (contextual forms like initial/medial/final) requires GSUB table parsing, which may not be fully implemented in opentype.js; ❌ Line wrapping and bidi reordering must be implemented manually |
| **B — node-canvas (native addon)** | Use `node-canvas` with Cairo/HarfBuzz backend for real text measurement. | ✅ Complete Arabic shaping via HarfBuzz; ✅ Proven in production; ❌ Native binary dependency (`node-gyp`); ❌ CI complexity; ❌ May not be available in all environments; ❌ Boxing/caching overhead |
| **C — Hybrid: fontkit for metrics + canvas for validation** | Use fontkit for fast glyph metrics; use node-canvas only for final export validation. | ✅ Best of both worlds; ❌ Two implementations to maintain; ❌ Potential mismatch between measurement systems |

**Recommended: Option A (fontkit + opentype.js)**
- Pure JavaScript, zero native dependencies
- Provides real glyph advance widths for accurate Arabic text measurement
- Cache by full typography request ensures deterministic repeatability
- If GSUB table parsing is insufficient for full contextual shaping, can be augmented with a simple shaping engine for Arabic (initial/medial/final forms)
- Falls back to Latin character-width table for non-Arabic scripts

### 13.2 Backtracking scope and performance boundary

**Cited requirements:**
- LCS-LBL-003: "Use ordered candidate assignment with backtracking for congested regions"
- LCS-LBL-003: "If still none: request local geometry relaxation"

**Question:** At what scale does backtracking become too expensive? For 1,386 people, each with 4–6 candidates, the search space is enormous.

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — Full backtracking with limit** | Implement full backtracking as described, with a configurable maximum backtrack depth (e.g., 5 labels). | ✅ Matches spec; ✅ Handles local congestion; ❌ May fail on large congested regions; ❌ Hard to bound worst-case runtime |
| **B — Greedy with local backoff** | Greedy assignment; if a label fails, try local rearrangements within a sliding window of N neighbors. | ✅ O(n) instead of exponential; ✅ Predictable performance; ❌ May miss global optimum; ❌ Deviates from spec |
| **C — Greedy with failure reporting** | Greedy assignment; if no candidate fits, record LABEL_PLACEMENT_IMPOSSIBLE and continue. No backtracking. | ✅ Simplest; ✅ Meets the "expose unresolved reasons" requirement; ❌ May leave many labels unplaced in dense regions |

**Recommended: Option A** with a configurable backtrack depth limit (default 10).
- Start with greedy assignment
- If a label has no valid candidate, backtrack up to N labels in the sorted difficulty order
- If backtracking also fails, record LABEL_PLACEMENT_IMPOSSIBLE (satisfying LCS-LBL-003's requirement to expose reasons)
- The limit prevents unbounded runtime while matching the spec's algorithm

### 13.3 Candidate positioning: curve-tangent alignment vs. fixed offsets

**Cited requirements:**
- LCS-LBL-002: "Candidate Families: aligned with branch, offset above branch, offset below branch, lateral, terminal leaf, cartouche zone"
- LNGP-R3-06 §4: "Generate candidates near the person anchor: along branch, beside branch, above or below, terminal leaf position"

**Question:** How precisely should "aligned with branch" work for curved branches?

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — Tangent-aligned** | Compute the branch tangent at the endpoint (via `cubicBezierTangent()`), rotate the label to match. | ✅ Natural visual alignment with curved branches; ❌ May exceed `maximumRotationDegrees` for steep curves |
| **B — Fixed horizontal** | All labels are horizontal (0° rotation) regardless of branch direction. | ✅ Simpler; ✅ Maximum readability; ❌ May not follow branch direction aesthetically |
| **C — Tangent-aligned, clamped to config** | Compute tangent, clamp rotation to ±`maximumRotationDegrees`. | ✅ Best of both; ✅ Config-controlled; ✅ Matches spec intent |

**Recommended: Option C**
- Compute branch tangent at endpoint using `cubicBezierTangent()`
- Clamp rotation to ±`LabelConfig.maximumRotationDegrees`
- This respects the config already defined in the codebase

### 13.4 Leader line collision testing

**Cited requirements:**
- LCS-LBL-003: "No crossing leader lines" (hard rule)
- LCS-LBL-002: `LabelCandidate.leaderLength: number` field

**Question:** Are leader lines part of the collision envelope, or only the label bounds?

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — Leader lines are collision shapes** | The leader line (anchor-to-bounds) is included in collision testing. | ✅ Prevents crossing leaders (hard rule); ❌ More complex collision shapes (line segments vs. AABB) |
| **B — Leader lines are visual only** | Only label bounds are collision-tested; leaders are drawn but not collision-checked. | ✅ Simpler; ❌ May produce crossing leader lines violating the hard rule |
| **C — Leader lines as thin segments** | Leaders are collision-tested as thin line segments (width ≈ 1). | ✅ Prevents crossing leaders; ✅ Minimal impact on other collisions; ❌ Adding line-segment collision testing to the narrow phase |

**Recommended: Option C**
- Leader lines are tested as line segments against other label bounds and branches
- Use existing `pointSegmentDistance` and `intersectSegments` from geometry module
- This satisfies the hard rule without significant complexity

### 13.5 Terminal leaf label size increase

**Cited requirements:**
- LCS-LBL-002: "A terminal leaf label MAY be larger than ordinary branch labels but MUST remain within boundary and collision rules."
- LNGP-R3-06 §8: "People without descendants may use leaf forms."

**Question:** What "larger" means quantitively? Larger font size, larger padding, or both?

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — Larger font size** (e.g., 1.25× minimum) | Terminal labels use a larger font size (configurable scale factor). | ✅ Simple; ✅ Matches "larger" language |
| **B — Larger padding** (e.g., 1.5× personPadding) | Terminal labels add padding around the text. | ✅ More space for emphasis; ❌ May conflict with dense areas |
| **C — Both** | Larger font AND larger padding, configurable via scale factors. | ✅ Most flexible; ❌ More config fields |

**Recommended: Option C** with a `LabelConfig.terminalLabelScale` factor (default 1.2 for size, 1.0 for padding).
- Only applies to persons with no children in the skeleton
- Added to `LabelConfig` interface as optional fields

### 13.6 `SolveContext` in `LabelLayoutEngine.place()`

**Cited requirements:**
- LCS-CON-005: `place(input: LabelLayoutInput, ctx: SolveContext): LabelLayoutResult`

**Question:** `SolveContext` is not defined anywhere. What does it contain?

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — Define minimal SolveContext** | `{ readonly collisionIndex: CollisionIndex; readonly policy: CollisionPolicy; readonly diagnostics?: DiagnosticCollector }` | ✅ Contains everything labels needs; ✅ Passes existing collision infrastructure |
| **B — Use existing types directly** | Skip `SolveContext` and pass collision data directly in `LabelLayoutInput` | ✅ Fewer types; ❌ Deviates from spec contract |
| **C — SolveContext as opaque extensible bag** | `{ readonly [key: string]: unknown; readonly diagnostics?: DiagnosticCollector }` | ✅ Most extensible; ❌ No type safety |

**Recommended: Option A**
- `SolveContext` contains `collisionIndex`, `CollisionPolicy`, and optional `DiagnosticCollector`
- Defined in `src/core/labels/types.ts`
- If future milestones need more context (stability data, worker state), they can add fields

### 13.7 `LabelLayoutInput` definition

**Cited requirements:**
- LCS-CON-005: `place(input: LabelLayoutInput, ctx: SolveContext): LabelLayoutResult`

**Question:** What should `LabelLayoutInput` contain?

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — Skeleton + person data** | `{ readonly skeletonPlan: SkeletonPlan; readonly graph: GenealogyGraph; readonly configuration: LabelConfig }` | ✅ Contains all needed data; ✅ Graph provides person names and metadata |

**Recommended: Option A**
- `LabelLayoutInput` includes the frozen `SkeletonPlan` (from M3), `GenealogyGraph` (from M1/M2), and `LabelConfig`
- The graph provides person names (Arabic names text) — already normalized in M1
- The `SolveContext` provides collision data

### 13.8 `LabelLayoutResult` definition

**Cited requirements:**
- LCS-CON-005: `place(...): LabelLayoutResult`

**Options:**

| Option | Description | Consequences |
|---|---|---|
| **A — With metrics and reasons** | `{ accepted: boolean; placements: readonly LabelPlacement[]; unresolvedReasons: readonly UnresolvedLabelReason[]; metrics: LabelLayoutMetrics; deterministicFingerprint: string }` | ✅ Rich output; ✅ Satisfies "expose unresolved candidate reasons"; ✅ Deterministic fingerprint for Gate 6 |

**Recommended: Option A**
- Follows the pattern established by `SkeletonPlan` and `CollisionValidationReport`
- `LabelLayoutMetrics` includes: `totalPersonCount`, `placedLabelCount`, `unplacedLabelCount`, `collisionCount`, `minimumFontSize`, `maximumRotation`, `averageAnchorDistance`

---

## 14. Recommended Implementation Order

1. Define types (`src/core/labels/types.ts`) — resolving ambiguities 13.6, 13.7, 13.8
2. Implement `TextMeasurementService` with fontkit/opentype.js caching (resolve 13.1)
3. Implement `LabelCandidateGenerator` — generate candidates from skeleton branches and person data (resolve 13.3, 13.5)
4. Implement `LabelCandidateScorer` — score and rank candidates
5. Extend `CollisionEngine` to accept label placements and test branch–label, label–label collisions
6. Implement `LabelSolver` — ordered assignment with backtracking (resolve 13.2, 13.4)
7. Implement `LabelValidator` — hard rule validation (overlap, minimum size, leader crossing)
8. Implement `LabelLayoutEngine.place()` — orchestrate measurement → candidates → scoring → solving → validation
9. Unit tests, property tests, integration tests
10. Wire into `src/index.ts`, `solve-stage.ts`, `issues.ts`, `identifiers.ts`
11. Architecture doc and traceability matrix
12. Full regression test suite (all 207 existing tests must continue to pass)

---

## 15. Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Arabic shaping in pure JS may be incomplete | High | Test with real Arabic genealogy data; fall back to canvas-based measurement for export if needed |
| Backtracking solver may be slow for 1,386 people | Medium | Configurable backtrack depth limit; greedy fallback |
| Font dependency for measurement | Medium | Bundle a minimal Arabic font (e.g., `Noto Naskh Arabic`) for testing; document font policy |
| Collision extension may break existing tests | High | Add overloads, never change existing signatures; full regression suite required |
| RTL + rotation interaction | Medium | Measure in pre-rotation space; rotate afterward; verify in integration tests |

---

*This report is documentation-only. No code has been written, edited, generated, committed, or pushed beyond this report. No files outside this report have been modified.*
