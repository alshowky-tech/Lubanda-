# Pre-Implementation Report: Milestone 4.2 — Collision Safety

**Date:** 2026-07-28
**Status:** Pre-implementation documentation only — no code written
**Authoritative baseline:** `862ac7327d224b601c1d2aaf58a27b49e502ffd2` (Milestone 4.1.1 v2)

---

## 1. Milestone Identification

| Field | Value |
|---|---|
| **Specification name** | Milestone 6 — Collision Safety |
| **Repo numbering** | Milestone 4.2 |
| **Build Order position** | 6 of 11 |
| **Pipeline stage** | Stage 8 — Resolve Geometry |
| **Phase (Bible)** | Phase 2 — Skeleton Engine |
| **Module** | `core/collision/` |

---

## 2. Source Documents and Headings

| # | Document | Code | Heading / Section | Content |
|---|---|---|---|---|
| 1 | Build Order (Implementation Plan) | LCS-IMP-002 | "Milestone 6 — Collision Safety" | *"Implement broad and narrow phase checks and local repair."* |
| 2 | Canonical Pipeline (Project Architecture) | LCS-ARC-002 | "Stage 8 — Resolve Geometry" | *"Detect and resolve collisions and boundary violations."* |
| 3 | Module Map (Project Architecture) | LCS-ARC-001 | "2. Dependency Direction" | `spatial ────► collision`, `skeleton ────► collision`, `collision ──► labels` |
| 4 | Collision Contracts (Engine Contracts) | LCS-CON-004 | Full document | Defines `CollisionEngine { index(), testCandidate(), validateLayout() }`, `CollisionTestResult`, `CollisionRecord` |
| 5 | Collision Detection (Geometry and Collision) | LCS-GEO-004 | Full document | Broad phase (spatial index envelope query), narrow phase (adaptive curve-to-curve / capsule chains), envelope radius formula, adjacent exemption, self-collision |
| 6 | Boundary and Template Constraints (Geometry and Collision) | LCS-GEO-005 | "Boundary Clearance" | *"Elements MUST remain inside by their full collision envelope, not only by centerline."* |
| 7 | Bible: Collision Engine (Release 3) | LNGP-R3-05 | Full document (9 sections) | Collision classes, conservative geometry, spatial index, segment testing, continuous safety, resolution strategy (1–7), prohibited resolutions, clearance levels, diagnostics |
| 8 | Bible: Implementation Sequence (Release 5) | LNGP-R5-12 | "Step 8 — Collision and Relaxation" | *"Guarantee clearance and resolve local congestion."* |
| 9 | End-to-End Solve Pseudocode (Algorithms) | LCS-ALG-001 | Full pseudocode | `skeleton = CollisionResolver.resolve(skeleton)` — collision resolution occurs after skeleton merge, before label placement |
| 10 | Decision Priority (Governance) | LCS-GOV-002 | Priority #3 | Collision avoidance is priority 3 (after genealogical correctness #1 and parent-child readability #2) |
| 11 | Acceptance Gates (Testing and Benchmarks) | LCS-TST-005 | "Gate 3 — Geometry" | *"Zero forbidden crossings and boundary violations."* |
| 12 | First 90-Day Plan (Implementation Plan) | LCS-IMP-003 | "Days 46–60" | Includes *"collision resolution"* and *"first non-crossing skeleton"* |
| 13 | Core Engine v1.0 Release Definition | LCS-IMP-005 | Full document | *"no forbidden crossings remain"* required for release |

---

## 3. Required Deliverables

### 3.1 Contracts (from LCS-CON-004)

**CollisionEngine interface:**
```ts
interface CollisionEngine {
  index(graph: SkeletonGraph, labels?: readonly LabelPlacement[]): CollisionIndex;
  testCandidate(candidate: PathCandidate, index: CollisionIndex, policy: CollisionPolicy): CollisionTestResult;
  validateLayout(layout: LayoutResult, policy: CollisionPolicy): CollisionValidationReport;
}
```

**CollisionTestResult:**
```ts
type CollisionTestResult =
  | { valid: true; minimumClearance: number }
  | { valid: false; collisions: readonly CollisionRecord[] };
```

**CollisionRecord** (LCS-CON-004) MUST include:
- element IDs,
- collision class,
- closest points,
- penetration or clearance deficit,
- severity,
- recommended resolution scope.

### 3.2 Detection Algorithm (from LCS-GEO-004)

**Envelope radius formula:**
```
radius = branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin
```

**Broad phase:** Query spatial index using candidate envelope bounds.
**Narrow phase:** Adaptive curve-to-curve distance or capsule chains.
**Adjacent exemption:** Parent-child connected edges may share geometry only within a bounded junction region.
**Self-collision:** A long curve MUST be tested against non-adjacent portions of itself.
**Exact final validation:** SHOULD use stricter sampling tolerance than interactive candidate testing.

### 3.3 Resolution Strategy (from LNGP-R3-05 §6)

Preferred order:
1. reject candidate,
2. bend path,
3. shift junction,
4. adjust territory,
5. move label,
6. local relaxation,
7. escalate to regional re-solve.

### 3.4 Prohibited Resolutions (from LNGP-R3-05 §7)

- drawing one branch behind another,
- reducing opacity,
- hiding with bark,
- allowing collision at export,
- shrinking labels below readability.

### 3.5 Collision Classes (from LNGP-R3-05 §1)

- branch–branch,
- branch–label,
- label–label,
- branch–boundary,
- label–boundary,
- branch–decoration,
- self-intersection.

---

## 4. Acceptance Criteria

| Criterion | Source | Verification |
|---|---|---|
| Zero forbidden crossings and boundary violations | Gate 3 — Geometry (LCS-TST-005) | Automated tests + property tests |
| Repeated fixed-seed runs serialize identically | Gate 6 — Determinism (LCS-TST-005) | Property test with byte-identical comparison |
| Collision avoidance is hard constraint | Priority #3 (LCS-GOV-002) | Must override space utilization and visual beauty |
| Module complete: interface + tests + diagnostics + error behavior + no hidden dependency + downstream contracts satisfied | Definition of Done (LCS-GOV-001 §7) | Manual review + test suite |
| Full collision envelope, not only centerline | Boundary Clearance (LCS-GEO-005) | Envelope radius formula in narrow phase |
| Collision reports identify exact entities and closest points | Bible §9 (LNGP-R3-05) | CollisionRecord fields |

---

## 4. Expected Files to Create or Modify

### 4.1 New files

| File | Purpose |
|---|---|
| `src/core/collision/types.ts` | CollisionIndex, CollisionRecord, CollisionTestResult, CollisionPolicy, CollisionValidationReport, collision error codes |
| `src/core/collision/CollisionEngine.ts` | CollisionEngine implementation: index(), testCandidate(), validateLayout() |
| `src/core/collision/CollisionIndex.ts` | Spatial index wrapper for branch envelopes (or adapter over existing SpatialHash) |
| `src/core/collision/CollisionResolver.ts` | Local repair / resolution engine implementing the resolution strategy (preferred order) |
| `src/core/collision/ConstraintSolver.ts` | Clearance constraint checking: minimum distance, boundary containment, self-collision |
| `src/core/collision/index.ts` | Barrel exports |
| `schemas/collision-report.schema.json` | Schema for validation reports |
| `tests/unit/collision/CollisionEngine.test.ts` | Unit tests for CollisionEngine |
| `tests/unit/collision/CollisionResolver.test.ts` | Unit tests for resolver |
| `tests/unit/collision/ConstraintSolver.test.ts` | Unit tests for constraint solver |
| `tests/property/collision.property.test.ts` | Property-based tests (determinism, no crossings) |
| `tests/integration/skeleton-to-collision.test.ts` | Integration from skeleton output through collision resolution |
| `docs/architecture/milestone-4.2-architecture.md` | Architecture document |
| `docs/traceability/milestone-4.2-matrix.md` | Traceability matrix |

### 4.2 Modified files

| File | Change |
|---|---|
| `src/index.ts` | Add `export * from "./core/collision/index.js"` |
| `src/core/contracts/solve-stage.ts` | Add `MILESTONE_4_2_STAGES` (collision stages) |
| `src/core/contracts/identifiers.ts` | Add collision-related brand types if needed |
| `src/core/contracts/issues.ts` | Add `COLLISION_ISSUE_CODES` array |
| `configs/default-engine-configuration.json` | Add/update collision config defaults |
| `schemas/error-codes.schema.json` | Add collision issue codes |

### 4.3 Unchanged (out of scope)

All files under `core/labels/`, `core/stability/`, `core/visual/`, `core/export/`, `core/ai/`, `ui/`, `workers/` must NOT be touched.

---

## 5. Explicit Out-of-Scope Items

The following are NOT part of this milestone and MUST NOT be implemented:

- ❌ Label placement or text measurement (Milestone 7 — Labels)
- ❌ Incremental reflow or prior-layout constraints (Milestone 8 — Stability)
- ❌ Web Workers or checkpointing (Milestone 9 — Scale)
- ❌ Bark rendering, leaves, themes, templates (Milestone 10 — Visual Layer)
- ❌ SVG/PNG/PDF export or production UI (Milestone 11 — Export and Production UI)
- ❌ AI style analysis or AI rendering (deferred)
- ❌ Arabic text processing beyond what already exists
- ❌ UI components of any kind
- ❌ Changing genealogy, import, validation, geometry primitives, spatial hash, demand, territory, skeleton growth, or routing logic (those are completed milestones — preserve their behavior)
- ❌ Creating new architecture that introduces dependencies on React, workers, or external renderers

---

## 6. Dependencies on Completed Milestones

| Dependency | Module | Provides |
|---|---|---|
| M1 — Contracts | `core/contracts/` | StageResult, EngineIssue, DiagnosticEvent, identifiers |
| M1 — Configuration | `core/config/` | `CollisionConfig` (already defined with `branchClearance`, `labelClearance`, `barkAllowance`) |
| M3 — Geometry Primitives | `core/geometry/` | `Vec2`, `CubicBezier`, `Bounds`, `Polygon`, segment intersection, adaptive sampling, distance functions |
| M3 — Spatial Index | `core/spatial/` | `SpatialHash<T>` with `insert`, `remove`, `update`, `query`, `clear` — usable as broad-phase query engine |
| M3 — Determinism | `core/determinism/` | `stableUnit()`, `canonical-json`, `rounding` |
| M3 — Skeleton Growth | `core/skeleton/` | `SkeletonPlan`, `SkeletonBranch` (with `curve: CubicBezier`, `thickness: BranchThicknessParameters`), `SkeletonNode` |
| M4 — Demand and Territory | `core/territory/` | Territory polygons, corridors, junction zones |
| M4.1 — Routing | `core/routing/` | `RoutingPlan`, `RoutingRecord` (with `obstacleClearances`, `corridorPolygon`, `branchRadius`, `safetyMargin`, `requiredClearance`), `ClearanceModel` (with `computeRequiredClearance`, `computeBranchRadius`) |
| M3/M4.1 — Diagnostics | `core/diagnostics/` | `DiagnosticCollector` pattern |
| Phase Gates | LCS-TST-005 | Gate 3 (Geometry) and Gate 6 (Determinism) acceptance criteria |

---

## 7. Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Ambiguity in envelope formula could cause inconsistent results between routing and collision | Medium | Resolve via stakeholder decision before implementation |
| Resolution algorithm scope could expand mid-implementation | High | Start with detection + rejection only (step 1 of resolution strategy) |
| `LayoutResult` and `SkeletonGraph` not existing could force contract changes | Medium | Define minimal types within `collision/types.ts` and map from `SkeletonPlan` |
| Existing 150 tests must not regress | High | Run full test suite after each implementation step |

---

## 8. Unresolved Ambiguities (with cited requirements, options, consequences, and recommendations)

### 8.1 Collision envelope source: Routing corridor vs. skeleton branch curve

#### Cited specification requirements

**LCS-GEO-004 (Collision Detection):**
> "radius = branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin"

**LCS-GEO-005 (Boundary and Template Constraints):**
> "Elements MUST remain inside by their full collision envelope, not only by centerline."

**LNGP-R3-05 §2 (Conservative Geometry):**
> "Use expanded collision shapes that include: stroke radius, bark allowance, safety margin, print tolerance."

**`src/core/routing/ClearanceModel.ts` (existing code):**
```ts
export const computeRequiredClearance = (
  radiusA: number, radiusB: number,
  safetyMarginA, safetyMarginB
): number => radiusA + radiusB + safetyMarginA + safetyMarginB;
```

**`src/core/routing/types.ts` (RoutingRecord):**
- `branchRadius: number` — computed structural radius per generation
- `safetyMargin: number` — configured safety margin
- `corridorPolygon: Polygon` — reserved corridor polyline
- `requiredClearance: number` — maximum pairwise clearance

**`src/core/config/types.ts` (CollisionConfig):**
```ts
export interface CollisionConfig {
  readonly branchClearance: number;
  readonly labelClearance: number;
  readonly barkAllowance: number;
}
```

#### Proposed resolution options

**Option A — Consume RoutingPlan corridor polygons directly**
- Collision reads `corridorPolygon` from each `RoutingRecord` as the collision envelope shape
- No new envelope computation; the corridor already encodes the reserved width
- Envelope radius computation exists only in routing's ClearanceModel

*Consequences:*
- ✅ Zero duplication of envelope logic
- ✅ Guarantees routing and collision operate on identical geometry
- ✅ Fastest path to implementation
- ❌ Corridor polygons are coarse approximations (4–10 points) and may miss fine-grained curve curvature
- ❌ If routing's corridor algorithm changes, collision results change implicitly
- ❌ The corridor polygon represents a *swept* region, not a strict per-branch collision envelope — it may be wider than necessary for collision testing

**Option B — Build collision envelopes from skeleton branch curves + CollisionConfig**
- Collision computes envelope radius per branch using `computeEnvelopeRadius(branchHalfWidth, barkAllowance, classClearance, safetyMargin)`
- The envelope is applied as an expanded bounding box/radius around the skeleton's `CubicBezier` curve
- Uses: `SkeletonBranch.curve` + `CollisionConfig.barkAllowance` + `CollisionConfig.branchClearance` + `RoutingRecord.safetyMargin`

*Consequences:*
- ✅ Envelope precisely follows the actual curve geometry
- ✅ Independent of routing corridor implementation details
- ❌ Duplicates clearance configuration between routing and collision (two places to keep in sync)
- ❌ A routing-only change (e.g., wider corridors) would NOT be reflected in collision detection
- ❌ More computation (curve sampling, bounds expansion per branch)

**Option C — Hybrid: consume RoutingRecord's `branchRadius` and `safetyMargin`, compute envelope from skeleton curve data**
- Collision reads structural data from RoutingRecord (`branchRadius`, `safetyMargin`) but computes its own bounds from `SkeletonBranch.curve`
- Envelope radius formula: `branchRadius + barkAllowance + branchClearance + safetyMargin`
- All from RoutingRecord for structural params, CollisionConfig for class params

*Consequences:*
- ✅ Single source for structural branch parameters (RoutingRecord)
- ✅ Bounds follow actual curve geometry (from SkeletonBranch.curve)
- ✅ All three config terms (barkAllowance, branchClearance, safetyMargin) participate
- ❌ Still uses the routing clearance formula indirectly — must ensure the canonical formula lives in one place
- ❌ Requires routing module exports to be stable

#### Recommended decision: **Option C**
- Collision should read `branchRadius` and `safetyMargin` from the existing `RoutingRecord` (single source of truth for structural dimensions)
- Collision should compute its own envelope bounds from `SkeletonBranch.curve` (the actual curve geometry, not the coarse corridor polygon)
- The envelope formula should live in routing's `ClearanceModel.ts` (canonical location) and be imported by collision
- The corridor polygon is used for boundary-containment testing (template validation) only

---

### 8.2 Resolution algorithm implementation scope

#### Cited specification requirements

**LCS-IMP-002 (Build Order):**
> "Milestone 6 — Collision Safety: Implement broad and narrow phase checks and **local repair**."

**LCS-ARC-002 (Canonical Pipeline), Stage 8:**
> "Detect and **resolve** collisions and boundary violations."

**LCS-ALG-001 (End-to-End Solve Pseudocode):**
```text
skeleton = CollisionResolver.resolve(skeleton)
```

**LNGP-R3-05 §6 (Resolution Strategy):**
> "Preferred order:
> 1. reject candidate,
> 2. bend path,
> 3. shift junction,
> 4. adjust territory,
> 5. move label,
> 6. local relaxation,
> 7. escalate to regional re-solve."

**LNGP-R3-05 §7 (Prohibited Resolutions):**
> "drawing one branch behind another, reducing opacity, hiding with bark, allowing collision at export, shrinking labels below readability."

**LCS-GOV-002 (Decision Priority), Priority #3:**
> "Collision avoidance" — a hard constraint that must override space utilization and visual beauty.

#### Proposed resolution options

**Option A — Detection only (report collisions, no automatic resolution)**
- CollisionEngine detects collisions and returns `CollisionValidationReport`
- No skeleton modification
- Downstream caller decides what to do

*Consequences:*
- ✅ Simplest, lowest risk of introducing bugs
- ✅ Leaves resolution strategy to the orchestration layer
- ❌ Does not satisfy "local repair" from LCS-IMP-002
- ❌ The pseudocode explicitly shows `CollisionResolver.resolve(skeleton)` modifying the skeleton
- ❌ No automatic path to "zero forbidden crossings" (Gate 3)

**Option B — Local repair: deterministic annotation and resolution-scope assignment**
- Collision detects violations and assigns each a `ResolutionScope` (from the preferred order)
- Returns a `LocalRepairResult` with `pendingActions` and `unresolvedCollisions`
- Does NOT mutate the skeleton geometry (no bending, shifting, or re-routing)
- The orchestration layer uses the actions to guide downstream repair

*Consequences:*
- ✅ Satisfies "local repair" as defined (repair = identify what needs fixing + how)
- ✅ No global mutable state — pure function
- ✅ Each collision record carries a recommended resolution, enabling downstream repair
- ❌ Does not automatically achieve "zero forbidden crossings" — downstream must act
- ❌ Some may consider this "detection with recommendations" rather than true repair

**Option C — Full local repair: implement steps 1–3 of the resolution strategy**
- Implement rejection of colliding candidates (step 1)
- Implement path bending via control-point nudging (step 2)
- Implement junction shifting (step 3)
- All within deterministic constraints

*Consequences:*
- ✅ Fully satisfies "local repair" and "resolve geometry"
- ✅ The pipeline pseudocode's `CollisionResolver.resolve(skeleton)` would return a modified skeleton
- ❌ "Bend path" requires a path-bending algorithm that does not exist anywhere in the codebase — substantial new work
- ❌ "Shift junction" requires territory/corridor awareness — could cascade into territory re-solving
- ❌ High risk of scope creep — this could expand to half a milestone on its own
- ❌ Risk of introducing non-determinism

#### Recommended decision: **Option B** for this milestone
- Implement detection + resolution-scope assignment
- The resolver returns `LocalRepairResult` with `pendingActions: LocalRepairAction[]`
- Each action records: branchId, collisionClass, resolutionScope, clearanceDeficit
- The skeleton is NOT mutated by collision — mutation is deferred to downstream stages
- This satisfies "local repair" as: *deterministically identify what needs local repair and how to repair it*
- Steps 2–7 of the preferred order are explicitly deferred to future milestones that implement path bending, junction shifting, etc.

---

### 8.3 RoutingPlan interaction: does collision consume the RoutingPlan or rebuild from raw skeleton?

#### Cited specification requirements

**LCS-CON-004 (Collision Contracts):**
```ts
interface CollisionEngine {
  index(graph: SkeletonGraph, labels?: readonly LabelPlacement[]): CollisionIndex;
  ...
}
```
(Note: `SkeletonGraph` is not defined in any existing module.)

**LCS-ALG-001 (End-to-End Solve Pseudocode):**
```text
skeleton = SkeletonEngine.merge(fragments)
skeleton = CollisionResolver.resolve(skeleton)
```
(The pipeline shows collision receiving a skeleton, not a RoutingPlan.)

**LCS-ARC-001 (Module Map), Dependency Direction:**
```text
skeleton ────► collision
spatial ────► collision
```
(Collision depends on skeleton and spatial, not explicitly on routing.)

**Existing `src/core/routing/types.ts` (RoutingRecord):**
```ts
export interface RoutingRecord {
  readonly branchRadius: number;         // ← structural dimension needed by collision
  readonly safetyMargin: number;         // ← clearance parameter needed by collision
  readonly corridorPolygon: Polygon;     // ← spatial region needed by collision
  readonly requiredClearance: number;    // ← already-computed pairwise clearance
  readonly obstacleClearances: readonly ObstacleClearanceRecord[];  // ← already-discovered obstacles
  ...
}
```

#### Proposed resolution options

**Option A — Collision consumes the full RoutingPlan as direct input**
- CollisionInput includes `routingPlan: RoutingPlan` and `routingRecordMap: Map<SkeletonBranchId, RoutingRecord>`
- Collision reads `branchRadius`, `safetyMargin`, `corridorPolygon` from each routing record
- Collision does NOT recompute branch radii or safety margins from skeleton data

*Consequences:*
- ✅ Single source of truth for branch dimensions (routing computed it first)
- ✅ Reuses obstacle-discovery data already computed by routing
- ✅ Faster: no recomputation of branch radii
- ❌ Ties collision tightly to RoutingPlan's data model — changes to routing types affect collision
- ❌ The pipeline pseudocode shows collision receiving `skeleton`, not `routingPlan` (cosmetic: the pseudocode predates M4.1)

**Option B — Collision rebuilds everything from skeleton + configuration**
- CollisionInput takes only `SkeletonPlan` + `CollisionConfig`
- Collision independently computes branch radii, safety margins, and envelope bounds
- RoutingPlan data is unused

*Consequences:*
- ✅ Fully independent of routing module — no cross-module coupling
- ✅ Cleaner contract: collision depends only on skeleton + config
- ❌ Duplicates computation already done by routing (branch radius per generation)
- ❌ Two independent clearance computations that could diverge silently
- ❌ Routing's obstacle discovery data is thrown away

**Option C — Collision consumes selected RoutingRecord fields as an input interface**
- CollisionInput includes a `BranchCollisionData` interface that contains only the fields collision needs
- The caller maps from RoutingRecord to BranchCollisionData when constructing the input
- This decouples collision from routing types while still consuming routing-derived data

*Consequences:*
- ✅ Decoupled from routing types — collision only depends on its own input contract
- ✅ Still consumes routing-derived data (single source for structural dimensions)
- ✅ Clear boundary: routing transforms skeleton data, collision consumes the transformed result
- ❌ Requires a mapping layer (boilerplate, but minimal)
- ❌ More types to maintain

#### Recommended decision: **Option A** (with an interface boundary)
- CollisionInput directly includes `routingPlan` and `routingRecordMap`
- Collision reads only the fields it needs: `branchRadius`, `safetyMargin`, `corridorPolygon.points`
- This is the simplest path and respects the constraint that routing data is already computed
- The dependency direction `skeleton ────► collision` from LCS-ARC-001 is widened to `skeleton + routing ────► collision`, which reflects the actual pipeline order

---

### 8.4 Self-collision threshold quantification

#### Cited specification requirements

**LCS-GEO-004 (Collision Detection):**
> "Self-Collision: A long curve MUST be tested against non-adjacent portions of itself."

**LCS-GEO-004 (Collision Detection):**
> "Final validation SHOULD use a stricter sampling tolerance than interactive candidate testing."

**No other specification document defines:**
- What "long" means quantitatively
- What "non-adjacent portions" means quantitatively
- How to segment a curve for self-testing

#### Proposed resolution options

**Option A — Absolute length threshold (e.g., 120 units)**
- A curve is "long" if its approximate length > 120 units
- "Non-adjacent" = portions separated by at least 1/3 of the curve's parametric domain
- Threshold is configurable via `CollisionPolicy.selfCollisionMinimumLength`

*Consequences:*
- ✅ Simple, deterministic, easy to test
- ✅ Configurable for different tree scales
- ❌ 120 units is arbitrary — may miss self-collisions in smaller trees
- ❌ A fixed threshold does not scale with template size

**Option B — Relative threshold (e.g., 3× the envelope radius)**
- A curve is "long" if its length exceeds 3× its own envelope radius
- "Non-adjacent" = portions separated by at least 1/3 of total length

*Consequences:*
- ✅ Scales automatically with branch size
- ✅ More principled than a magic number
- ❌ More complex to compute (requires length + envelope radius per branch)
- ❌ Could miss self-collisions in very thick, short curves

**Option C — Always test any curve with ≥ 8 sample points**
- Use the adaptive sampler's output: if the curve required ≥ 8 sample points to approximate, it has enough curvature to warrant self-testing
- "Non-adjacent" = segments separated by at least 1/3 of sample count

*Consequences:*
- ✅ Automatically adapts to curve complexity — complex curves are tested, straight lines are not
- ✅ Reuses existing sampling infrastructure
- ❌ Sample count depends on tolerance setting — could vary with configuration

#### Recommended decision: **Option A** (with configurable threshold)
- Default `selfCollisionMinimumLength = 120` (configurable in `CollisionPolicy`)
- A curve is sampled, its length approximated, then compared against the threshold
- "Non-adjacent" = segments separated by at least 1/3 of the sampled curve points
- This matches the existing codebase patterns (configurable constants with sensible defaults)
- The 120-unit default is sufficient for the official workbook's template size (~4000×2500)

---

### 8.5 Clearance formula reconciliation: routing vs. collision

#### Cited specification requirements

**Existing `src/core/routing/ClearanceModel.ts`:**
```ts
// routing clearance: both branches' dimensions + both safety margins
export const computeRequiredClearance = (radiusA, radiusB, safetyMarginA, safetyMarginB): number =>
    radiusA + radiusB + safetyMarginA + safetyMarginB;
```

**LCS-GEO-004 (Collision Detection):**
```text
// collision envelope: per-branch expanded shape
radius = branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin
```

**`src/core/config/types.ts` (CollisionConfig):**
```ts
export interface CollisionConfig {
  readonly branchClearance: number;   // "classClearance" for branch–branch
  readonly labelClearance: number;    // "classClearance" for branch–label
  readonly barkAllowance: number;     // "barkAllowance" in envelope formula
}
```

**Existing routing constants (`src/core/routing/types.ts`):**
```ts
export const DEFAULT_SAFETY_MARGIN = 4;
```

#### Analysis

The two formulas serve different purposes:

| Formula | Purpose | Scope | Terms |
|---|---|---|---|
| Routing `computeRequiredClearance` | Pairwise minimum distance between two branches | Two branches | `radiusA + radiusB + safetyMarginA + safetyMarginB` |
| LCS-GEO-004 envelope radius | Per-branch collision envelope radius | One branch | `branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin` |

They are **complementary, not contradictory**. The envelope radius feeds into the pairwise clearance:

```
envelopeA = branchHalfWidth_A + barkAllowance + classClearance + safetyMargin_A
envelopeB = branchHalfWidth_B + barkAllowance + classClearance + safetyMargin_B
pairwiseMinimum = envelopeA + envelopeB
```

This is algebraically equivalent to:
```
branchHalfWidth_A + branchHalfWidth_B + 2×barkAllowance + 2×classClearance + safetyMargin_A + safetyMargin_B
```

While routing's formula is:
```
radiusA + radiusB + safetyMarginA + safetyMarginB
```

The reconciliation: replace `radiusA` with `branchHalfWidth_A + barkAllowance + classClearance`.

#### Proposed resolution options

**Option A — Extend routing's clearance model to include collision terms**
- Add `computeEnvelopeRadius(branchHalfWidth, barkAllowance, classClearance, safetyMargin)` to routing's `ClearanceModel.ts`
- Routing continues to use `computeRequiredClearance` unchanged
- Collision calls `computeEnvelopeRadius` to get per-branch envelopes, then computes pairwise as `envelopeA + envelopeB`

*Consequences:*
- ✅ Single canonical file for all clearance computation
- ✅ Routing unchanged (backward compatible)
- ✅ Collision gets exactly the formula LCS-GEO-004 specifies
- ❌ Collision computes pairwise clearance differently from routing (two-step vs one-step)

**Option B — Unify into a single `computePairwiseClearance` that accepts all terms**
- Single function: `computePairwiseClearance(radiusA, radiusB, barkAllowance, classClearance, safetyMarginA, safetyMarginB)`
- Called by both routing and collision with appropriate parameters
- Routing passes `barkAllowance=0, classClearance=0` (their computation predates collision)

*Consequences:*
- ✅ Truly unified single formula
- ✅ Clear evolution path: as routing adopts bark/class terms, they just change their call
- ❌ More parameters = more complexity
- ❌ Routing callers must supply extra zeros (confusing API)

**Option C — Define envelope radius in collision config, keep routing formula as-is**
- Collision defines its own `computeEnvelopeRadius` in its own module
- Routing is not touched
- Collision uses the envelope radius as the "radius" when calling routing's `computeRequiredClearance`

*Consequences:*
- ✅ Zero changes to routing (safest for backward compatibility)
- ❌ Two separate clearance computations that could diverge over time
- ❌ Violates the "one canonical formula" principle

#### Recommended decision: **Option A**
- Add `computeEnvelopeRadius(branchHalfWidth, barkAllowance, classClearance, numericalSafetyMargin)` to `src/core/routing/ClearanceModel.ts`
- This is the canonical per-branch envelope formula from LCS-GEO-004
- Collision imports and uses this function to compute per-branch envelopes
- Pairwise clearance for collision = `envelopeA + envelopeB`
- Routing continues to use its own `computeRequiredClearance` for its own purposes
- Both live in the same module → canonical single source of truth

---

### 8.6 `validateLayout` input type: what replaces `LayoutResult`?

#### Cited specification requirements

**LCS-CON-004 (Collision Contracts):**
```ts
interface CollisionEngine {
  validateLayout(layout: LayoutResult, policy: CollisionPolicy): CollisionValidationReport;
}
```

**Current codebase:**
- No `LayoutResult` type exists anywhere
- The closest types are: `SkeletonPlan` (skeleton output), `RoutingPlan` (routing output), `FrozenSkeleton` (frozen layout output)
- There is no combined skeleton+routing+labels type yet

#### Proposed resolution options

**Option A — accept `CollisionInput` (the same input used by `index()`)**
- `validateLayout(input: CollisionInput, policy: CollisionPolicy): CollisionValidationReport`
- `CollisionInput` already contains both `SkeletonPlan` and `RoutingPlan`

*Consequences:*
- ✅ Consistent API: `index()` and `validateLayout()` take the same input
- ✅ No new type needed
- ❌ Deviates from the spec's `LayoutResult` parameter name
- ❌ If `LayoutResult` is later defined, the API must change

**Option B — define a minimal `LayoutResult` type now**
```ts
interface LayoutResult {
  readonly skeletonPlan: SkeletonPlan;
  readonly routingPlan: RoutingPlan;
}
```

*Consequences:*
- ✅ Closer to the spec's contract
- ✅ Forward-compatible with future expansion (labels, stability)
- ❌ Adds a type that only has two fields right now — may feel like premature abstraction

**Option C — defer and accept `SkeletonPlan` only (closest to the pseudocode)**
- The pseudocode shows `CollisionResolver.resolve(skeleton)` — the resolver takes a skeleton
- validateLayout currently only needs skeleton + routing data

*Consequences:*
- ✅ Matches the pipeline pseudocode
- ❌ Ignores routing data that collision needs for envelope computation
- ❌ Will require a breaking change when labels are added

#### Recommended decision: **Option A**
- `validateLayout(input: CollisionInput, policy: CollisionPolicy): CollisionValidationReport`
- `CollisionInput` already bundles skeleton, routing, and config
- No `LayoutResult` type is created — it will be introduced when the Labels milestone needs it
- This is documented as a known divergence from LCS-CON-004 that will be resolved when LayoutResult is defined

---

### 8.7 `SkeletonGraph` contract type

#### Cited specification requirements

**LCS-CON-004 (Collision Contracts):**
```ts
interface CollisionEngine {
  index(graph: SkeletonGraph, labels?: readonly LabelPlacement[]): CollisionIndex;
}
```

**Current codebase:**
- `SkeletonGraph` is undefined in all modules
- The closest type is `SkeletonPlan` (`src/core/skeleton/types.ts`) which contains: `branches`, `nodes`, `trunk`, `mappedJunctions`, `validation`
- The spec's `SkeletonGraph` likely refers to a graph view of skeleton topology (nodes + edges)

#### Proposed resolution options

**Option A — accept `SkeletonPlan` directly instead of `SkeletonGraph`**
- `index(input: CollisionInput): CollisionIndex`
- `CollisionInput.skeletonPlan: SkeletonPlan` provides all needed skeleton data

*Consequences:*
- ✅ Uses the existing, well-defined type
- ✅ No new type definition needed
- ❌ `SkeletonPlan` may contain fields irrelevant to collision (diagnostics, validation reports, metadata)
- ❌ Deviates from the spec's `SkeletonGraph` name

**Option B — define a minimal `SkeletonGraph` type that wraps skeleton topology**
```ts
interface SkeletonGraph {
  readonly branches: readonly SkeletonBranch[];
  readonly nodes: readonly SkeletonNode[];
}
```

*Consequences:*
- ✅ Closer to the spec's contract
- ✅ Clean interface: only the fields collision needs
- ✅ Forward-compatible — can be extended with edge data later
- ❌ Requires mapping from `SkeletonPlan` → `SkeletonGraph` at the call site

#### Recommended decision: **Option A**
- Accept `SkeletonPlan` (via `CollisionInput`) rather than defining a new `SkeletonGraph`
- The spec's `SkeletonGraph` is an abstract contract name that maps to `SkeletonPlan` in the current implementation
- If a future milestone requires a true graph type (with adjacency, traversal), a `SkeletonGraph` can be introduced then
- This is documented as a known simplification of LCS-CON-004

---

### 8.8 `CollisionPolicy` and `CollisionValidationReport` definitions

#### Cited specification requirements

**LCS-CON-004 (Collision Contracts):**
```ts
interface CollisionEngine {
  testCandidate(candidate: PathCandidate, index: CollisionIndex, policy: CollisionPolicy): CollisionTestResult;
  validateLayout(layout: LayoutResult, policy: CollisionPolicy): CollisionValidationReport;
}
```

**LCS-CON-004 — `CollisionTestResult`:**
```ts
type CollisionTestResult =
  | { valid: true; minimumClearance: number }
  | { valid: false; collisions: readonly CollisionRecord[] };
```

**LCS-CON-004 — `CollisionRecord`:**
> MUST include: element IDs, collision class, closest points, penetration or clearance deficit, severity, recommended resolution scope.

**No specification document defines the fields of `CollisionPolicy` or `CollisionValidationReport`.**

#### Proposed resolution options for `CollisionPolicy`

| Option | Fields | Consequences |
|---|---|---|
| **A — Feature toggles** | `checkBranchBranch: boolean`, `checkBranchBoundary: boolean`, `checkSelfCollision: boolean` | ✅ Simple; ❌ Not configurable enough |
| **B — Feature toggles + configurable thresholds** | All of A + `finalValidationTolerance: number`, `adjacentJunctionRadius: number`, `selfCollisionMinimumLength: number` | ✅ Flexible; ✅ Covers detection algorithm parameters; Recommended |
| **C — Full extensible policy** | All of B + `clearanceMultiplier: number`, `allowedCollisionClasses: CollisionClass[]`, `severityThresholds: ...` | ✅ Future-proof; ❌ Over-engineered for this milestone |

#### Proposed resolution options for `CollisionValidationReport`

| Option | Fields | Consequences |
|---|---|---|
| **A — Minimal** | `accepted: boolean`, `collisions: CollisionRecord[]` | ✅ Simple; ❌ No aggregate metrics |
| **B — With metrics** | All of A + `metrics: { branchCount, collisionCount, clearanceDeficitCount, penetrationCount, boundaryViolationCount, selfIntersectionCount, minimumClearance, maximumClearanceDeficit }` | ✅ Rich queryable report; ✅ Enables Gate 3 verification; Recommended |
| **C — With resolution guidance** | All of B + `pendingActions: LocalRepairAction[]` | ✅ Most useful; ❌ Blurs boundary between detection and resolution |

#### Recommended decisions

**`CollisionPolicy`: Option B**
```ts
export interface CollisionPolicy {
  readonly checkBranchBoundary: boolean;
  readonly checkSelfCollision: boolean;
  readonly checkBranchBranch: boolean;
  readonly finalValidationTolerance: number;       // stricter sampling for final validation
  readonly adjacentJunctionRadius: number;          // exemption zone for parent-child junctions
  readonly selfCollisionMinimumLength: number;      // curve length threshold for self-testing
}
```

**`CollisionValidationReport`: Option B**
```ts
export interface CollisionValidationMetrics {
  readonly branchCount: number;
  readonly testedPairCount: number;
  readonly collisionCount: number;
  readonly clearanceDeficitCount: number;
  readonly penetrationCount: number;
  readonly boundaryViolationCount: number;
  readonly selfIntersectionCount: number;
  readonly minimumClearance: number;
  readonly maximumClearanceDeficit: number;
}

export interface CollisionValidationReport {
  readonly accepted: boolean;
  readonly collisions: readonly CollisionRecord[];
  readonly metrics: CollisionValidationMetrics;
}
```

Default policy values:
- `selfCollisionMinimumLength`: 120 (see 8.4)
- `adjacentJunctionRadius`: 24 (matches existing junction zone patterns)
- `finalValidationTolerance`: 2 (stricter than the interactive 4)
- All feature toggles default to `true`

---

## 9. Recommended Implementation Order

1. Define types (`collision/types.ts`) — resolving ambiguities 8.6, 8.7, 8.8 first
2. Extend routing's `ClearanceModel.ts` with `computeEnvelopeRadius` (resolve 8.5)
3. Implement `CollisionIndex` (wrapper over `SpatialHash` using envelope radii from RoutingRecord data) (resolve 8.1, 8.3)
4. Implement `ConstraintSolver` — narrow-phase distance checks (branch–branch, branch–boundary, self-collision with configured threshold from 8.4)
5. Implement `CollisionEngine.index()` and `testCandidate()`
6. Implement `CollisionResolver` — detection + resolution-scope assignment (resolve 8.2, Option B)
7. Implement `CollisionEngine.validateLayout()` — exact final validation with strict tolerance
8. Unit tests, property tests, integration tests
9. Wire into `src/index.ts`, `solve-stage.ts`, `issues.ts`, `identifiers.ts`
10. Architecture doc and traceability matrix
11. Full regression test suite

---

*This report is documentation-only. No code has been written, edited, generated, committed, or pushed. No files have been modified beyond this report.*
