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

**CollisionRecord** MUST include:
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

## 5. Expected Files to Create or Modify

### 5.1 New files

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

### 5.2 Modified files

| File | Change |
|---|---|
| `src/index.ts` | Add `export * from "./core/collision/index.js"` |
| `src/core/contracts/solve-stage.ts` | Add `MILESTONE_4_2_STAGES` (collision stages) |
| `src/core/contracts/identifiers.ts` | Add collision-related brand types if needed |
| `src/core/contracts/issues.ts` | Add `COLLISION_ISSUE_CODES` array |
| `configs/default-engine-configuration.json` | Add/update collision config defaults |
| `schemas/error-codes.schema.json` | Add collision issue codes |

### 5.3 Unchanged (out of scope)

All files under `core/labels/`, `core/stability/`, `core/visual/`, `core/export/`, `core/ai/`, `ui/`, `workers/` must NOT be touched.

---

## 6. Explicit Out-of-Scope Items

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

## 7. Dependencies on Completed Milestones

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

## 8. Unresolved Ambiguities and Contradictions

The following issues have no authoritative resolution in the provided specification documents and must be resolved by stakeholders before implementation begins:

### 8.1 Collision envelope source: Routing corridor vs. skeleton branch curve

**Conflict:** The routing module (`RoutingRecord`) provides a `corridorPolygon` which represents the reserved area for a branch. The skeleton module (`SkeletonBranch`) provides a `curve: CubicBezier` and `thickness: BranchThicknessParameters`. The collision spec (LCS-GEO-004) says the envelope radius is `branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin`, while the routing clearance model uses `radiusA + radiusB + safetyMarginA + safetyMarginB`.

**Question:** Does Collision Safety consume the RoutingPlan's corridor polygons directly, or does it build its own collision envelopes from skeleton curves + thickness + bark + clearance? The pipeline diagram puts collision after skeleton merge, which suggests it works from raw skeleton geometry.

### 8.2 Resolution algorithm implementation

**Spec:** The Build Order says "local repair." The Bible (§6) gives a preferred order (reject candidate → bend path → shift junction → adjust territory → move label → local relaxation → regional re-solve). The pseudocode shows `CollisionResolver.resolve(skeleton)` returning a modified skeleton.

**Question:** How many resolution steps are required for this milestone? Is "bend path" feasible without a routing solver? Should M4.2 only detect collisions and reject them (leaving resolution to a future sub-milestone), or must it implement all resolution strategies listed?

### 8.3 RoutingPlan interaction

**Question:** Does the CollisionEngine consume the RoutingPlan as input, or does it rebuild clearance requirements from the raw skeleton + configuration? The RoutingPlan was designed for the earlier routing pipeline and its obstacle data; reusing it would mean passing it through. Not reusing it means collision computes its own envelope/clearance from skeleton geometry and CollisionConfig.

### 8.4 Self-collision threshold

**Spec:** LCS-GEO-004 says "A long curve MUST be tested against non-adjacent portions of itself."

**Question:** What is the quantitative threshold for "long"? What is the definition of "non-adjacent portions"? (e.g., a percentage of the curve's length, or a minimum segment-count separation along the parametric domain?)

### 8.5 Clearance formula reconciliation

**Conflict:** Routing clearance: `radiusA + radiusB + safetyMarginA + safetyMarginB` (ClearanceModel.ts). Collision spec envelope radius: `branchHalfWidth + barkAllowance + classClearance + numericalSafetyMargin` (LCS-GEO-004).

**Question:** Do these represent the same concept at different stages, or is one wrong? The routing formula combines two branches' radii and margins. The collision formula computes a per-branch envelope radius. Are they meant to be composed (collision envelope radius feeds into routing clearance) or are they alternatives?

### 8.6 `validateLayout` input type

**Spec:** LCS-CON-004 declares `validateLayout(layout: LayoutResult, policy: CollisionPolicy): CollisionValidationReport`. However, the current codebase has no `LayoutResult` type — it has `SkeletonPlan`, `RoutingPlan`, `FrozenSkeleton`, etc.

**Question:** Should `validateLayout` accept `SkeletonPlan` (post-collision) for this milestone? Should a `LayoutResult` type be introduced now, or deferred to the Labels milestone when it becomes meaningful?

### 8.7 `SkeletonGraph` contract type

**Spec:** LCS-CON-004 declares `index(graph: SkeletonGraph, labels?: readonly LabelPlacement[])` using `SkeletonGraph`.

**Question:** `SkeletonGraph` is not defined anywhere in the current codebase. Should this accept the existing `SkeletonPlan` type, or should a new `SkeletonGraph` type be introduced? The latter would require an architecture decision record.

### 8.8 `CollisionPolicy` and `CollisionValidationReport`

**Spec:** `CollisionPolicy` is referenced but not defined. `CollisionValidationReport` is referenced but not defined.

**Question:** Should these be defined as part of M4.2, or are they placeholders for a future milestone? What fields do each contain?

---

## 9. Risk Assessment

| Risk | Impact | Mitigation |
|---|---|---|
| Ambiguity in envelope formula could cause inconsistent results between routing and collision | Medium | Resolve via stakeholder decision before implementation |
| Resolution algorithm scope could expand mid-implementation | High | Start with detection + rejection only (step 1 of resolution strategy) |
| `LayoutResult` and `SkeletonGraph` not existing could force contract changes | Medium | Define minimal types within `collision/types.ts` and map from `SkeletonPlan` |
| Existing 150 tests must not regress | High | Run full test suite after each implementation step |

---

## 10. Recommended Implementation Order

1. Define types (`collision/types.ts`) — resolving ambiguities 8.6, 8.7, 8.8 first
2. Implement `CollisionIndex` (wrapper or adapter over `SpatialHash<SkeletonBranchId>` using envelope radii)
3. Implement `CollisionEngine.index()` — build index from skeleton branches
4. Implement `ConstraintSolver` — narrow-phase distance checks (branch–branch, branch–boundary, self-collision)
5. Implement `CollisionEngine.testCandidate()` — broad + narrow phase
6. Implement `CollisionResolver` — detection + simple local repair (rejection first)
7. Implement `CollisionEngine.validateLayout()` — exact final validation
8. Unit tests, property tests, integration tests
9. Wire into `src/index.ts`, `solve-stage.ts`, `issues.ts`, `identifiers.ts`
10. Architecture doc and traceability matrix
11. Full regression test suite

---

*This report is documentation-only. No code has been written, edited, generated, committed, or pushed. No files have been modified beyond this report.*
