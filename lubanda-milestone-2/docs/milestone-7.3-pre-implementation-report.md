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
| **M7 stages** | `SOLVE_LABELS` (exists in `MILESTONE_7_STAGES` as of M7.1) |

### Scope boundary

Milestone 7.3 performs **deterministic assignment only**. It selects exactly one candidate per person from the candidates already generated, validated, and scored by Milestone 7.2. It does **not** generate, validate, or score candidates. It does **not** implement the full LabelLayoutEngine contract — that is reserved for a later slice.

---

## 2. Source Documents and Headings

| # | Document | Code | Heading / Section | Key Content |
|---|---|---|---|---|
| 1 | Label Solver (Layout and Labels) | LCS-LBL-003 | Full document | Ordered assignment with backtracking; hard rules; unresolved reason exposure |
| 2 | Label and Stability Contracts | LCS-CON-005 | Full document | `LabelLayoutEngine.place()`, `IncrementalLayoutEngine`, `ConstraintManager` |
| 3 | Bible: Label Layout Engine | LNGP-R3-06 | §1–§10 | Hard constraints, soft objectives, terminal labels, search |
| 4 | End-to-End Solve Pseudocode | LCS-ALG-001 | Full text | `labels = LabelLayoutEngine.place(skeleton, graph)` |
| 5 | Decision Priority | LCS-GOV-002 | Priority #3, Hard vs Soft | Collision avoidance > readability; hard rules are pass/fail |
| 6 | Acceptance Gates | LCS-TST-005 | Gate 4 — Labels | Zero overlaps and minimum readability satisfied |
| 7 | Canonical Pipeline | LCS-ARC-002 | Stage 9 — Place Labels | "Measure and place labels" |
| 8 | Build Order | LCS-IMP-002 | Milestone 7 — Labels | "Implement real Arabic text measurement and **label candidate solver**" |

---

## 3. Candidate Assignment Model

### 3.1 Inputs

| Input | Source | Description |
|---|---|---|
| `SkeletonPlan` | M3 — Skeleton Growth | Approved skeleton (frozen, immutable) |
| `SkeletonBranchMap` | M3 — computed | Branch ID → SkeletonBranch |
| `GenealogyGraph` | M1/M2 — Import | Person data, child relationships |
| `LabelConfig` | M1 — Configuration | `minimumFontSize`, `maximumRotationDegrees` |
| `CandidateCollisionQuery` | M7.2 — CQ abstraction | Read-only obstacle query (branch envelopes, boundary, fixed labels) |
| `TemplateBoundary: Polygon` | M2 — Territory | Outer boundary |
| `TextMeasurementService` | M7.1 — Text Measurer | (immutable, used only for diagnostics) |
| `GeneratedCandidatesResult` | M7.2 — Generator output | `allCandidates`, `personCandidateMap`, `diagnostics` |

### 3.2 Output

```ts
interface LabelAssignmentResult {
  readonly placements: readonly LabelPlacement[];      // one per person
  readonly unplacedPersons: readonly UnresolvedLabelReason[];
  readonly metrics: LabelLayoutMetrics;
  readonly deterministicFingerprint: string;
}
```

### 3.3 Assignment rules

- Each person with at least one VALID candidate receives exactly one placement.
- The placement is selected from that person's VALID, scored candidates.
- The selection is deterministic and stable.
- A person with zero VALID candidates receives an `UnresolvedLabelReason` with code `ALL_CANDIDATES_COLLIDE`.
- A person with zero candidates of any status receives `NO_CANDIDATES_GENERATED`.
- The assignment must not introduce new collisions with already-placed labels (label–label collision).
- The assignment must respect all hard rules from LCS-LBL-003: no overlap, minimum font size, complete text visibility, correct person association, no crossing leader lines.

### 3.4 Immutability guarantees

- The `SkeletonPlan`, `GenealogyGraph`, and all branch/routing/collision inputs are never mutated.
- The assignment function creates only new arrays/objects for its return value.
- The output `LabelPlacement` objects are frozen.
- `deterministicFingerprint` is a SHA-256 of canonical JSON of the placements and unplaced persons.

---

## 4. Conflict Graph

### 4.1 Graph structure

```
  Person                    Person
    │                         │
    ▼                         ▼
Candidate A-1              Candidate B-1
Candidate A-2              Candidate B-2
Candidate A-3              Candidate B-3
    │                         │
    └──────────┬──────────────┘
               ▼
       Conflict Graph
  (bipartite overlay edges)
```

- **Nodes:** Every VALID candidate from M7.2.
- **Conflict edges:** A candidate A conflicts with candidate B if their placed bounds overlap (label–label conflict), or if A's leader line crosses B's bounds/label.
- **No edge:** Candidates for the same person are never in conflict with each other (only one is selected).
- **Fixed-obstacle edges:** Already handled by M7.2 validation; candidates entering the solver are already free of fixed-obstacle conflicts.

### 4.2 Graph properties

- The graph is a unit-disc intersection graph in 2D space (bounds overlap).
- Maximum degree is bounded by spatial density (not by person count).
- For 1,500 persons × ~6 candidates ≈ 9,000 nodes.
- Edge count is O(n × k) where k is the average number of overlapping candidates per cell, not O(n²).

### 4.3 Use in the solver

The solver does not explicitly build the conflict graph as a data structure. Instead, it checks label–label conflicts incrementally using `CandidateCollisionQuery.overlapsFixedLabel()` against the growing set of already-placed placements. This is equivalent to implicit conflict-graph traversal.

---

## 5. Conflict Types

| Type | Description | Detected by | Resolution |
|---|---|---|---|
| **Label–Label** | Two placements' bounds overlap | `overlapsFixedLabel()` | Skip candidate; try next; backtrack if impossible |
| **Label–Branch** | Placement overlaps a branch envelope outside self-anchor zone | M7.2 validation (pre-solver) | Already excluded; solver never sees these |
| **Leader–Branch** | Leader line crosses a branch envelope | M7.2 validation (pre-solver) | Already excluded; solver never sees these |
| **Boundary** | Placement extends outside template | M7.2 validation (pre-solver) | Already excluded |
| **Leader–Leader** | Two leader lines cross | Future extension | Deferred; requires segment–segment test between leader lines |
| **Cartouche overlap** | Cartouche placement overlaps non-cartouche | Same as label–label | Handled by general overlap check |
| **Terminal leaf overlap** | Leaf placement overlaps another label | Same as label–label | Handled by general overlap check |

### 5.1 Future extension points

- Leader–leader crossing detection (add leader segments to overlap checks).
- Branch–label clearance relaxation (re-score rather than hard reject).
- Cartouche zone priority (cartouche placements get priority within their zone).

---

## 6. Solver Alternatives

### 6.1 Comparison

| Approach | Deterministic | Complexity | Memory | Determinism | Suitability |
|---|---|---|---|---|---|
| **Greedy** | ✅ Yes (stable sort) | O(n log n + n·d) | O(n) | ✅ Stable ordering, no randomness | Good for sparse graphs |
| **Priority queue** | ✅ Yes (FIFO tie-break) | O(n log n + n·d) | O(n) | ✅ Stable ordering | Equivalent to greedy with heap |
| **Backtracking** (spec reference) | ✅ Yes (ordered backtracking) | O(n·b^d) worst case | O(n·k) | ✅ Deterministic search order | Required by LCS-LBL-003 |
| **Branch-and-bound** | ✅ Yes | O(2^n) worst | O(n) | ✅ BFS with pruning | Overkill for labels |
| **Maximum independent set** | ❌ NP-hard | Exponential | High | ❌ | Not suitable |
| **Constraint satisfaction** | ✅ Yes | O(n²·k²) typical | O(n·k) | ✅ With fixed variable ordering | Equivalent to backtracking |

### 6.2 Recommendation: **Greedy with limited backtracking**

The specification (LCS-LBL-003) describes ordered candidate assignment with backtracking. The recommended approach is:

1. **Sort persons by difficulty** (fewest candidates, largest area, highest local density, stable prior label first).
2. **For each person, try their ranked VALID candidates in score order.** Pick the first that does not conflict with already-placed labels.
3. **If none fits:** backtrack up to N labels (default 10) by releasing their placements and retrying.
4. **If backtracking also fails:** record `BACKTRACK_EXHAUSTED` for this person and continue.

This matches the spec's reference strategy while bounding worst-case runtime. Pure greedy (no backtracking) is the simplest correct implementation and is the recommended default; backtracking is added only when congested regions require it.

| Aspect | Value |
|---|---|
| **Time (expected)** | O(n log n + n·d) — n people, d average candidates per person |
| **Time (worst case)** | O(n·b·k) — b backtrack depth, k overlap checks per try |
| **Memory** | O(n) for placements array + O(1) per person |
| **Determinism** | ✅ Stable sort, deterministic tie-breaking, no random seeds |

### 6.3 Target

For 1,500 people with ~6 candidates each: ~9,000 candidates to evaluate, ~9,000 overlap checks in the greedy pass. Expected runtime well under 100ms in JavaScript.

---

## 7. Determinism

| Property | Mechanism |
|---|---|
| **Stable ordering** | Persons sorted by difficulty; candidates sorted by score, then family priority, then anchor distance, then candidate index |
| **Stable tie-breaking** | Multi-key sort with no random fallback; lowest PersonId wins when all else is equal |
| **Repeatability** | Same input always produces the same `placements[]` and `deterministicFingerprint` |
| **Seed independence** | No pseudo-random generation used in assignment |
| **Canonical ordering** | Placements sorted by person ID; fingerprint is SHA-256 of canonical JSON |

---

## 8. Tie-Breaking (Complete Ordering)

The complete deterministic ordering for assignment is:

```
Primary sort key:   generation (ascending — trunk labels first)
Secondary key:      person difficulty (fewest candidates → most)
Tertiary key:       candidate score (descending)
Quaternary key:     family priority (ALIGNED → ABOVE → BELOW → LATERAL → LEAF → CARTOUCHE)
Quinary key:        anchor distance from branch endpoint (ascending)
Senary key:         candidate index within person (ascending)
Septenary key:      person ID (lexicographic ascending)
```

This ordering is applied at two levels:

1. **Person ordering** for assignment iteration: by `(fewestCandidates, generation, personId)`.
2. **Candidate ordering** within a person: by `(score desc, familyPriority, anchorDistance, candidateIndex)`.

The family priority numeric mapping:

| Family | Priority |
|---|---|
| ALIGNED_WITH_BRANCH | 1 (highest) |
| OFFSET_ABOVE_BRANCH | 2 |
| OFFSET_BELOW_BRANCH | 3 |
| LATERAL | 4 |
| TERMINAL_LEAF | 5 |
| CARTOUCHE_ZONE | 6 |

No ambiguity: every candidate has a unique position in the ordering (candidateIndex + personId guarantee uniqueness).

---

## 9. Complexity Analysis

### 9.1 Time complexity

| Phase | Operation | Cost |
|---|---|---|
| Sort persons by difficulty | Stable sort of n persons | O(n log n) |
| For each person, try candidates | n × d overlap checks | O(n·d) |
| Each overlap check | AABB–AABB + leader–branch | O(b) where b = average branch count in spatial query |
| Backtracking (per trigger) | Release k placements, retry k persons | O(k·d) |
| **Expected total** | | **O(n log n + n·d·b)** |
| **Worst case** (dense backtrack) | | **O(n·d·b·k)** |

### 9.2 Space complexity

| Data | Size |
|---|---|
| Input candidates | O(n·d) |
| Placements array | O(n) |
| Person–candidate index | O(n) |
| Unresolved reasons | O(n) |
| Backtrack stack | O(k) |
| **Total** | **O(n·d)** |

### 9.3 Target

For 1,500 people × 6 candidates = 9,000 candidates:
- Sort: ~15,000 comparisons
- Greedy pass: ~9,000 overlap checks
- Each overlap check: ~10–50 bounding box comparisons (spatial hash)
- Expected total: ~200,000 AABB comparisons (under 50ms in JS)

---

## 10. Failure Behaviour

### 10.1 Diagnostics

Every person who cannot be placed receives an `UnresolvedLabelReason`:

| Code | Condition |
|---|---|
| `NO_CANDIDATES_GENERATED` | Person has no candidates at all (M7.2 produced none) |
| `ALL_CANDIDATES_COLLIDE` | Person has candidates, but all conflict with already-placed labels |
| `BACKTRACK_EXHAUSTED` | Backtracking attempted but no assignment found within the backtrack limit |
| `GEOMETRY_RELAXATION_FAILED` | (Future) local relaxation attempted but failed — deferred to M8 |
| `TEXT_TOO_LONG` | Text measurement exceeds the configured maximum width |
| `FONT_MISSING` | Configured font could not be loaded |

### 10.2 Partial failure

The assignment function does NOT abort on the first failure. It continues placing remaining persons and collects all unresolved reasons into the output. The `LabelLayoutResult.accepted` flag is `true` only when `unplacedPersons.length === 0`.

### 10.3 No silent failures

- Every unresolved person is recorded with a structured reason.
- The `deterministicFingerprint` covers placements and unresolved reasons alike.
- Downstream consumers (M7.4 Validator, M8 Stability, M10 Visual) can distinguish partial from complete failure.

---

## 11. Interaction with Future Milestones

| Milestone | Relationship | Boundary |
|---|---|---|
| **M7.4 — Layout Validation** | Consumes M7.3 placements; validates final output | M7.3 produces placements; M7.4 validates them |
| **M8 — Stability** | Consumes M7.3 placements as `previousLayout` | M8 adds incremental re-solve; M7.3 is the initial solve |
| **M10 — Visual Layer** | Consumes M7.3 placements for label rendering | M10 never modifies placement geometry |
| **M11 — Export** | Consumes placements for SVG/PDF label output | M11 never modifies label positions |

### 11.1 No scope leakage

- M7.3 does NOT implement `LabelLayoutEngine.place()` — that is the full orchestration that will combine M7.1 (measure) + M7.2 (generate/score) + M7.3 (assign) + M7.4 (validate). The full `place()` implementation is deferred until M7.4 completes.
- M7.3 does NOT implement incremental re-solve — that is M8.
- M7.3 does NOT implement geometry relaxation — that is M8.
- M7.3 does NOT implement rendering, SVG, or export — those are M10/M11.
- M7.3 does NOT re-implement any M7.2 logic (generation, validation, scoring) — those are complete.

---

## 12. Traceability

| # | Decision | Source | Justification |
|---|---|---|---|
| T1 | One placement per person | LCS-LBL-003, LNGP-R3-06 §1 | "Place person names" — each person gets one label |
| T2 | Greedy with limited backtracking | LCS-LBL-003 | "Ordered candidate assignment with backtracking" |
| T3 | Backtrack depth default = 10 | M7.2 pre-implementation report §13.2 | Configurable limit per approved decision |
| T4 | Label–label conflict detection via `overlapsFixedLabel` | M7.2 `CandidateCollisionQuery` interface | Reuses existing read-only abstraction |
| T5 | No fixed-obstacle re-validation | M7.2 | Already validated by `LabelCandidateValidator` |
| T6 | Deterministic fingerprint SHA-256 | LCS-TST-005 Gate 6 | Repeated runs serialize identically |
| T7 | Stable sort by multi-key ordering | LCS-GOV-002 | No randomness; deterministic tie-breaking |
| T8 | BOUNDARY_VIOLATION separated from BRANCH_PENETRATION | M7.2 `LabelCandidateValidator` | Boundary violations use separate code |
| T9 | Partial failure with unresolved reasons | LCS-LBL-003 | "The solver MUST expose unresolved candidate reasons" |
| T10 | `deterministicFingerprint` covers failures | LCS-TST-005 Gate 6 | Determinism includes failure modes |

---

## 13. Explicit Exclusions

Milestone 7.3 will NOT implement:

- ❌ Label rendering
- ❌ SVG, PNG, PDF, or any export format
- ❌ Skeleton geometry generation or modification
- ❌ Branch routing or re-routing
- ❌ Candidate generation (M7.2 complete)
- ❌ Candidate validation against fixed obstacles (M7.2 complete)
- ❌ Candidate scoring (M7.2 complete)
- ❌ Text measurement (M7.1 complete)
- ❌ Collision index or collision engine (M4.2 complete)
- ❌ AI style analysis or AI-assisted placement
- ❌ Interactive label dragging or repositioning (UI)
- ❌ Prior-layout stability scoring (M8)
- ❌ Incremental reflow or re-solving (M8)
- ❌ The full `LabelLayoutEngine.place()` orchestration (deferred to M7.4)

---

## 14. Recommended Implementation Order

1. Define `LabelAssignmentInput` type (wraps `GeneratedCandidatesResult` + `CandidateCollisionQuery` + `LabelConfig` + `TemplateBoundary`).
2. Implement `buildPersonDifficultyOrder()` — stable sort of persons by candidate count, generation, and person ID.
3. Implement `selectBestCandidate(person, candidates, fixedPlacements)` — iterate ranked VALID candidates, test `overlapsFixedLabel`, return first non-conflicting.
4. Implement `assignCandidates()` — iterate difficulty-ordered persons, call `selectBestCandidate`, accumulate placements and unresolved.
5. Implement `backtrack()` — when no candidate fits, release last N placements and retry the stuck person.
6. Implement `computeFingerprint()` — SHA-256 of canonical JSON of the result.
7. Implement `resolveLocalRelaxationRequest` stub — deferred to M8 (returns `GEOMETRY_RELAXATION_FAILED`).
8. Unit tests: assignment, tie-breaking, backtracking, failure cases.
9. Property tests: deterministic replay, valid score range, no skipped persons with valid candidates.
10. Integration test: M7.2 candidates → M7.3 assignment → validated placements.

---

*This report is documentation-only. No production code, tests, schemas, or dependencies have been added. No existing source files have been modified.*
