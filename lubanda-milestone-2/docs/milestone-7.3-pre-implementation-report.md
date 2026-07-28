# Pre-Implementation Report: Milestone 7.3 — Label Candidate Assignment

**Date:** 2026-07-28
**Status:** Pre-implementation documentation only — no code written
**Authoritative baseline:** `d390668697e95a4106eacc3571aae2f9c56e65e0` (Milestone 7.2 approved)

---

## 1. Milestone Identification

| Field | Value |
|---|---|
| **Specification name** | Milestone 7 — Labels (part 3: Assignment) |
| **Repo numbering** | Milestone 7.3 |
| **Build Order position** | 7 of 11 |
| **Pipeline stage** | Stage 9 — Place Labels |
| **Module** | `core/labels/` |
| **M7 stage label** | `SOLVE_LABELS` (exists in `MILESTONE_7_STAGES` as of M7.1) |

### Scope

Milestone 7.3 performs **deterministic assignment only**. It selects zero or one candidate per person from the candidates already generated, validated, and scored by Milestone 7.2. It does **not** generate, validate, or score candidates. Dynamic candidate-to-selected-placement conflict detection is IN scope and is distinct from M7.2 fixed-obstacle validation and from the M4.2 collision engine.

---

## 2. Source Documents

| # | Code | Heading | Content |
|---|---|---|---|
| 1 | LCS-LBL-003 | Full | Ordered candidate assignment with backtracking; hard rules; unresolved reason exposure |
| 2 | LCS-CON-005 | Full | `LabelLayoutEngine.place()`, `IncrementalLayoutEngine`, `ConstraintManager` |
| 3 | LNGP-R3-06 | §1–§10 | Hard constraints, soft objectives, terminal labels, search |
| 4 | LCS-ALG-001 | Full | `labels = LabelLayoutEngine.place(skeleton, graph)` |
| 5 | LCS-GOV-002 | Priority #3, Hard vs Soft | Collision avoidance > readability; hard constraints pass/fail |
| 6 | LCS-TST-005 | Gate 4 — Labels | Zero overlaps and minimum readability satisfied |
| 7 | LCS-ARC-002 | Stage 9 | "Measure and place labels" |
| 8 | LCS-IMP-002 | Milestone 7 | "Implement real Arabic text measurement and label candidate solver" |

---

## 3. Candidate Assignment Model

### 3.1 Inputs

| Input | Source | Description |
|---|---|---|
| `SkeletonPlan` | M3 | Approved skeleton (frozen, immutable) |
| `SkeletonBranchMap` | M3 | Branch ID → SkeletonBranch |
| `GenealogyGraph` | M1/M2 | Person data, child relationships |
| `LabelConfig` | M1 | `minimumFontSize`, `maximumRotationDegrees` |
| `LabelCollisionQuery` (see §7) | M7.3 | Read-only dynamic conflict abstraction (separate from M7.2 fixed-obstacle query) |
| `GeneratedCandidatesResult` | M7.2 | `allCandidates`, `personCandidateMap`, `diagnostics` |
| `CandidateCollisionQuery` (fixed obstacles) | M7.2 | Available but NOT used for dynamic checks |

### 3.2 Output

```ts
interface LabelAssignmentResult {
  readonly placements: readonly LabelPlacement[];
  readonly unplacedPersons: readonly UnresolvedLabelReason[];
  readonly metrics: LabelLayoutMetrics;
  readonly deterministicFingerprint?: string;  // optional (see §10)
}
```

### 3.3 Assignment rules

- A person with at least one VALID candidate that does not conflict with already-placed candidates receives exactly one placement.
- A person whose all VALID candidates conflict with already-placed placements receives an `UnresolvedLabelReason`.
- The selection is deterministic and stable.
- The assignment must not introduce new dynamic conflicts: label–label overlap, leader–label crossing, leader–leader crossing.
- Fixed-obstacle conflicts (branch penetration, boundary violation) are already rejected by M7.2 validation and are not re-checked.

### 3.4 Immutability

- All inputs are never mutated.
- The function creates only new arrays/objects for its return value.
- Output `LabelPlacement` objects are frozen.

---

## 4. Conflict Graph

### 4.1 Definition

The candidate conflict graph is defined as:

- **Nodes:** Every VALID candidate from M7.2.
- **Partitions:** Candidates are partitioned by person. At most one candidate may be selected from each partition (mutual exclusion through partition constraint, not through ordinary conflict edges).
- **Conflict edges:** An undirected edge connects candidate A and candidate B (from different persons) when simultaneously placing both would violate a dynamic hard constraint (see §5).

```
  Person A partition       Person B partition
  ┌──────────────┐        ┌──────────────┐
  │  A1 ─────────┼────────┤  B1          │
  │  A2          │        │  B2 ─────────┼──┐
  │  A3 ─────────┼────────┤  B3          │  │
  └──────────────┘        └──────────────┘  │
                                           │
                                 Person C   │
                                 partition  │
                                 ┌──────────┘
                                 │  C1
                                 │  C2
                                 │  C3
                                 └─────────
```

- Edges between partitions are labelled with the conflict type.
- Edges within a partition are implicit (the partition constraint ensures exclusivity).

### 4.2 Graph usage

The solver does **not** build the full conflict graph as a data structure. It performs incremental candidate-vs-placement checks as described in §7. The graph model exists for analysis and correctness reasoning only.

---

## 5. Dynamic Conflict Types

### 5.1 Conflicts resolved by M7.2 (fixed obstacles — not in scope)

The following are detected and rejected by M7.2 `LabelCandidateValidator`. The solver never sees these candidates:

- Label bounds ↔ branch envelope (outside self-anchor zone)
- Leader line ↔ branch envelope
- Label bounds ↔ template boundary
- Label bounds ↔ already-fixed label placements (from earlier pipeline stages)
- Rotation exceeds `maximumRotationDegrees`
- Non-finite geometry

### 5.2 Conflicts resolved by M7.3 (dynamic — IN scope)

| Type | Description | Detection | Hard constraint? |
|---|---|---|---|
| **Label–Label bounds** | Candidate bounds overlap a selected placement's bounds | AABB overlap | Yes — LCS-LBL-003 "no overlap" |
| **Candidate leader ↔ selected label bounds** | Candidate's leader line segment intersects a selected placement's AABB | Segment–AABB intersection | Yes — LCS-LBL-003 "no crossing leader lines" |
| **Candidate bounds ↔ selected leader** | Candidate placement bounds overlap a selected placement's leader segment | AABB–segment intersection | Yes |
| **Leader–leader crossing** | Candidate's leader line segment intersects a selected placement's leader line segment | Segment–segment intersection (PROPER or COLLINEAR_OVERLAP) | Yes — LCS-LBL-003 "no crossing leader lines" |

### 5.3 Endpoint-touch rules

All dynamic comparisons involve candidates/placements belonging to **different persons**. Candidates of the same person are partition-exclusive — at most one is selected, so no same-person dynamic comparison occurs. The own-branch self-anchor exemption is an M7.2 fixed-obstacle concern and does not apply here.

Cross-person leader contact policy (using the existing `intersectSegments` return types from M3):

| Intersection kind | Applies to | Ruling |
|---|---|---|
| `PROPER` | Leader–leader, leader–label bounds | **CONFLICT** — segments cross at an interior point |
| `COLLINEAR_OVERLAP` | Leader–leader | **CONFLICT** — segments lie on the same line and overlap over a non-zero interval |
| `ENDPOINT_TOUCH` | Leader–leader | **ALLOWED** — one leader endpoint touches another leader segment endpoint or interior without proper crossing |
| `COLLINEAR_TOUCH` | Leader–leader | **ALLOWED** — collinear segments meeting at a single endpoint |
| `ENDPOINT_TOUCH` | Leader ↔ label bounds | **CONFLICT** — a leader endpoint touching a label's AABB boundary is treated as overlap because bounds contain their boundary (closed intervals) |
| **AABB overlap** | Label bounds ↔ label bounds | **CONFLICT** — any overlap of closed intervals is a conflict (LCS-LBL-003 "no overlap") |

---

## 6. Solver Strategy

### 6.1 Selected strategy: deterministic greedy with bounded chronological backtracking

This matches LCS-LBL-003 ("ordered candidate assignment with backtracking for congested regions") and is the single recommended approach.

### 6.2 Algorithm

```text
placements = []
backtrackStack = []

for person in personsOrderedByDifficulty:
    for candidate in bestCandidatesForPerson(person):
        if conflicts with any placement in placements:
            continue
        placements.push(candidate)
        backtrackStack.push(person)
        break
    if no candidate placed:
        while backtrackStack is not empty
               and backtrackBudgetRemaining > 0:
            prevPerson = backtrackStack.pop()
            prevPlacement = remove placement for prevPerson
            for nextCandidate in candidatesFor(prevPerson, after=prevPlacement):
                if conflicts with placements:
                    continue
                placements.push(nextCandidate)
                backtrackStack.push(prevPerson)
                decrement backtrackBudgetRemaining
                retry original person
                break
        if still not placed:
            record BACKTRACK_EXHAUSTED for person
```

### 6.3 Decision frame

Each assignment of a candidate to a person creates a **decision frame** recording:

| Field | Type | Description |
|---|---|---|
| `personId` | `PersonId` | The person being assigned. |
| `selectedCandidateIndex` | integer | Index of the candidate selected for this person (from the person's ordered candidate list). |
| `nextCandidateIndex` | integer | Index of the candidate to try next if this frame is backtracked (selectedCandidateIndex + 1). |
| `placement` | `LabelPlacement` | The placement object added to the placements array. |

The decision frame does **not** store a copy of the full placements array. Instead, the backtrack operation removes the placement and restores the previous state by removing the placement at the known position.

### 6.4 Backtracking scope

When backtracking is triggered, the solver considers **only the most recently placed persons** in strict LIFO order (chronological backtracking). The deterministic person order is never changed — backtracking pops frames from the decision stack in reverse order and attempts the next untried candidate for each popped person. It does **not** perform random restarts, global reordering, or re-sorting.

Backtracking procedure:
1. Pop the most recent decision frame from the stack.
2. Remove its placement from the placements array.
3. Try the next candidate (at `nextCandidateIndex`) for that same person.
4. If a non-conflicting candidate is found, push a new frame and retry the originally stuck person.
5. If no candidate fits, pop the next frame and repeat.
6. If the budget is exhausted or the stack is empty, record `BACKTRACK_EXHAUSTED` for the stuck person and continue.

### 6.5 Backtracking budget

The backtracking budget is defined by a new `LabelConfig` field:

```ts
readonly maximumBacktrackDepth: number;
```

| Property | Value |
|---|---|
| **Accepted range** | 0 to 100 inclusive |
| **Default value** | 10 |
| **Meaning** | Maximum number of chronological decision frames (persons) that may be reconsidered when attempting to find room for one stuck person. Each popped frame counts as one unit, regardless of how many candidate alternatives exist for that frame. |
| **Value 0** | Disables backtracking entirely — the solver acts as pure greedy. |
| **Exhausted behaviour** | The solver records `BACKTRACK_EXHAUSTED` for the current person and continues to the next person in the deterministic order. |
| **Validation** | Negative values and non-integer values MUST be rejected at configuration validation time (M1 pattern: `TypeError`). |

If the configured budget is exhausted without finding a valid assignment, the solver records `BACKTRACK_EXHAUSTED` for the current person and **continues** to the next person without retrying further.

---

## 7. Dynamic Conflict Abstraction

Separate from M7.2's `CandidateCollisionQuery` (which tests fixed obstacles), M7.3 requires a read-only abstraction for dynamic candidate-vs-placement checks:

```ts
interface LabelCollisionQuery {
  /** True if candidate's bounds overlap placed bounds. */
  overlapsPlacedLabel(candidateBounds: Bounds, placement: LabelPlacement): boolean;

  /** True if candidate's leader segment intersects placed bounds. */
  leaderCrossesPlacedLabel(
    leaderStart: Vec2, leaderEnd: Vec2, placement: LabelPlacement,
  ): boolean;

  /** True if candidate's bounds intersect a placed leader segment. */
  labelCrossesPlacedLeader(
    candidateBounds: Bounds, placedLeaderStart: Vec2, placedLeaderEnd: Vec2,
  ): boolean;

  /** True if two leader segments properly intersect or collinearly overlap.
   *  Endpoint-touch without crossing is allowed (ENDPOINT_TOUCH, COLLINEAR_TOUCH). */
  leadersCross(a0: Vec2, a1: Vec2, b0: Vec2, b1: Vec2): boolean;
}
```

This abstraction:
- Does NOT replace or duplicate the M4.2 collision engine.
- Does NOT test branch envelopes, templates, or fixed obstacles (those are M7.2).
- Operates exclusively on candidate-vs-placement geometry; all dynamic comparisons are cross-person (same-person candidates are partition-exclusive).
- Is implementable using the existing `boundsOverlap` and `intersectSegments` geometry primitives from M3.
- Is fully deterministic.

---

## 8. Complete Ordering Tuples

### 8.1 Person ordering (determines iteration order)

```
(validCandidateCount ascending,
 staticConflictDegree descending,
 generation ascending,
 personId ascending)
```

| Key | Type | Definition | Rationale |
|---|---|---|---|
| `validCandidateCount` | integer | Count of VALID candidates for this person | Fewest candidates first (LCS-LBL-003: "fewest candidates"). Persons with fewer options get priority. |
| `staticConflictDegree` | integer | Number of distinct persons whose any VALID candidate has a conflict edge with any VALID candidate of this person. Computed once before assignment by pairwise candidate geometry checks. | Higher degree → more constrained → earlier placement. No dependence on current placements. No sampling. |
| `generation` | integer | Skeleton generation of this person's branch | Ancestors before descendants. Root-adjacent labels placed first. |
| `personId` | `PersonId` | Lexicographic ascending | Fully deterministic tie-break. |

The conflict edge test uses the same dynamic checks as §5.2 (bounds overlap, leader–label, leader–leader) but operates on candidate-vs-candidate geometry before any placement exists. Two persons conflict if any VALID candidate of person A conflicts with any VALID candidate of person B.

### 8.2 Candidate ordering within one person (determines selection order)

```
(score descending,
 familyPriority ascending,
 leaderLength ascending,
 rotationMagnitude ascending,
 candidateIndex ascending,
 candidateId ascending)
```

| Key | Type | Source | Rationale |
|---|---|---|---|
| `score` | number \| null | M7.2 `LabelCandidate.score` | Best scored candidate first. |
| `familyPriority` | integer | Derived from `LabelCandidateFamily` (ALIGNED=1, ABOVE=2, BELOW=3, LATERAL=4, LEAF=5, CARTOUCHE=6) | Prefer aligned labels. |
| `leaderLength` | number | M7.2 `LabelCandidate.leaderLength` | Shorter leaders preferred. |
| `rotationMagnitude` | number | `Math.abs(LabelCandidate.rotation)` | Less rotation preferred. |
| `candidateIndex` | integer | Position within the person's candidate array | Stable ordering. |
| `candidateId` | string | Generated during M7.2 (new field: `id: string`) | Final unambiguous tie-break. |

*Note:* `candidateId` is a new field required on `LabelCandidate`. It is a deterministic sequential identifier (e.g., `"candidate:p1:3"`) produced during M7.2 generation.

---

## 9. Failure and Completeness

### 9.1 Partial assignment permitted

The assignment function does NOT abort on the first failure. It continues placing remaining persons. The result may be **partially complete**: some persons receive placements, others receive `UnresolvedLabelReason`.

### 9.2 Completeness status

```ts
interface LabelAssignmentResult {
  readonly placements: readonly LabelPlacement[];          // placed persons
  readonly unplacedPersons: readonly UnresolvedLabelReason[];  // unplaced persons
  readonly metrics: LabelLayoutMetrics;
  readonly deterministicFingerprint?: string;
}
```

`placements` contains zero or one entry per person. The number of entries may be less than the number of persons in the skeleton. This is NOT a contradiction with "one per person" — it is "at most one per person, possibly none".

### 9.3 Unresolved reasons

| Code | Condition |
|---|---|
| `NO_CANDIDATES_GENERATED` | M7.2 produced no candidates for this person |
| `ALL_CANDIDATES_COLLIDE` | All VALID candidates conflict with already-placed placements |
| `BACKTRACK_EXHAUSTED` | Backtracking budget consumed, no conflict-free assignment found |
| `GEOMETRY_RELAXATION_FAILED` | Deferred to M8 (stub returns this code) |

### 9.4 Acceptance Gate 4 interaction

Gate 4 ("Zero overlaps and minimum readability satisfied") applies to the accepted layout after all stages (including M8 relaxation). A partial M7.3 result is **not** a failure of Gate 4 — it is an intermediate result that may be resolved by geometry relaxation (M8) or rejected at final validation. The solver's `accepted` flag (if present) reflects whether all persons could be placed, but the pipeline is responsible for escalating partial results.

### 9.5 No silent failures

Every unplaced person is recorded with a structured, machine-readable reason. Downstream consumers can distinguish complete from partial results.

---

## 10. Determinism and Fingerprinting

| Property | Mechanism |
|---|---|
| **Stable person order** | Multi-key tuple per §8.1 |
| **Stable candidate order** | Multi-key tuple per §8.2 |
| **Deterministic conflict detection** | `overlapsPlacedLabel`, `leaderCrossesPlacedLabel`, `leadersCross` return identical results for identical inputs |
| **Fingerprint** | Optional. Structural equality of the ordered output arrays (`placements` sorted by `personId`, `unplacedPersons` sorted by `personId`) is sufficient to prove determinism. SHA-256 is NOT required. |

### 10.1 Fingerprint is optional

No authoritative specification requires `deterministicFingerprint` in the assignment output. Gate 6 (Determinism) is satisfied by structural comparison of sorted output. A cryptographic SHA-256 fingerprint is not needed for determinism proof and introduces an unnecessary dependency. It MAY be included if the downstream `LabelLayoutEngine` contract requires it, but M7.3 does not mandate it.

---

## 11. Complexity Analysis

### 11.1 Time

| Phase | Cost | Notes |
|---|---|---|
| Sort persons by difficulty | O(n log n) | n = person count (≤ 1,500) |
| Greedy pass: try candidates | O(n · d · q) | d = avg candidates/person (≈6), q = dynamic conflict check cost (≈4 AABB/segment tests) |
| Backtracking (per trigger) | O(k · d · q) | k = backtrack depth (configurable) |
| **Expected total** | **O(n log n + n·d·q)** | ≈ 1,500 × 6 × 4 ≈ 36,000 geometric tests |
| **Worst case (dense backtrack)** | **O(n · k · d · q)** | Every person triggers backtracking of depth k |

*Note on dynamic queries:* Each `overlapsPlacedLabel` check compares one candidate against the current placements array. The placements array grows up to O(n). In the greedy pass this is O(n²) in worst case if every new candidate is checked against all existing placements. This can be bounded by spatial partitioning: group placements by spatial cell and check only placements in overlapping cells. The O(n·d·q) estimate above assumes such partitioning.

### 11.2 Space

| Data | Size |
|---|---|
| Placements array | O(n) |
| Backtrack stack | O(k) |
| Partition index (optional) | O(n) |
| **Total** | **O(n)** |

### 11.3 Performance targets (unverified)

The following are **unverified performance targets requiring benchmark evidence** before acceptance:

> For 1,500 persons × 6 candidates: expected greedy pass complete in under 100ms in JavaScript on target hardware.
>
> Backtracking depth of 10 adds at most 100ms additional in congested regions.

These targets have NOT been benchmarked and must be verified during implementation.

---

## 12. M7.4 Boundary

No authoritative project document defines "M7.4 — Layout Validation" as a separate milestone. The `LabelLayoutEngine.place()` contract (LCS-CON-005) is the full orchestration that will eventually combine M7.1 measurement + M7.2 generation/validation/scoring + M7.3 assignment + final validation. Whether final validation becomes a separate slice (M7.4) or is included in M7.3 is outside this document's scope.

M7.3 MUST:
- Expose a usable `assignCandidates()` API that produces `LabelAssignmentResult`.
- NOT depend on any undefined future stage for its own correctness.

If a future M7.4 slice is defined, it will consume M7.3's output and validate it. M7.3 is self-contained.

---

## 13. Explicit Exclusions

Milestone 7.3 will NOT implement:

- ❌ Candidate generation (M7.2)
- ❌ Fixed-obstacle candidate validation (M7.2)
- ❌ Candidate scoring (M7.2)
- ❌ Text measurement, shaping, or bidi processing (M7.1)
- ❌ Branch routing or skeleton geometry changes (M3, M4.1)
- ❌ Collision engine or collision index (M4.2)
- ❌ Label rendering or visual output (M10)
- ❌ SVG, PNG, PDF, or any export format (M11)
- ❌ Incremental reflow or stability constraints (M8)
- ❌ Geometry relaxation (M8)
- ❌ Prior-layout scoring (M8)
- ❌ AI style analysis or AI-assisted placement
- ❌ Interactive UI (label dragging, repositioning)
- ❌ The full `LabelLayoutEngine.place()` orchestration (deferred; see §12)

---

## 14. Traceability

| # | Decision | Source |
|---|---|---|
| T1 | At most one placement per person | LCS-LBL-003, LNGP-R3-06 §1 |
| T2 | Deterministic greedy with bounded chronological backtracking | LCS-LBL-003 |
| T3 | Backtrack budget from `LabelConfig.maximumBacktrackDepth`, default 10, range 0–100, validated against negative/non-integer | Engineering decision (see §6.5) |
| T4 | Label–Label conflict via `overlapsPlacedLabel` | §7 this report |
| T5 | Leader–leader crossing via `leadersCross` | LCS-LBL-003 "no crossing leader lines" |
| T6 | Separate person-ordering and candidate-ordering tuples | §8 this report |
| T7 | Partial assignment permitted | §9 this report |
| T8 | No hard-coded fingerprint; structural equality sufficient | LCS-TST-005 Gate 6 |
| T9 | Dynamic conflict abstraction separate from fixed-obstacle query | §7 this report |
| T10 | `candidateId` field needed on `LabelCandidate` | §8.2 this report |

---

## 15. Recommended Implementation Order

1. Add `candidateId: string` field to `LabelCandidate` type (M7.2 generation).
2. Define `LabelCollisionQuery` interface (§7).
3. Implement core geometric checks using existing `boundsOverlap`, `intersectSegments` (M3 primitives).
4. Implement `buildPersonOrder()` — multi-key sort per §8.1.
5. Implement `buildCandidateOrder()` — multi-key sort per §8.2.
6. Implement `assignCandidates()` — greedy pass with chronological backtracking (§6).
7. Unit tests: assignment, tie-breaking, backtracking, failure cases.
8. Property tests: deterministic replay, partial completion, no silent failures.
9. Integration test: M7.2 candidates → M7.3 assignment.

---

*This report is documentation-only. No production code, tests, schemas, or dependencies have been added. No existing source files have been modified.*
