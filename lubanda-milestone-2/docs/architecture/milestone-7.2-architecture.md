# Milestone 7.2 — Label Candidate Generation and Scoring Architecture

## Scope

Milestone 7.2 generates and scores label candidates for every person in an
approved SkeletonPlan. It does NOT place labels or solve conflicts—those
belong to Milestone 7.3. It produces scored LabelCandidate[] arrays that
the solver consumes.

## Modules

### CandidateCollisionQuery

Read-only abstraction over CollisionIndex. Wraps branch-envelope queries,
boundary containment, leader-line crossing tests, and self-anchor exemption.

### LabelCandidateGenerator

For each non-trunk branch: measures the person's name text, computes the
branch-endpoint anchor and tangent, generates candidates for each enabled
family (aligned, above, below, lateral, terminal leaf, cartouche), and
returns all candidates with initial VALID status and null scores.

### LabelCandidateValidator

Validates a single candidate against fixed obstacles: branch envelopes
(with self-anchor exemption), template boundary, rotation limit, glyph
overflow, leader-line crossing, already-placed labels. Returns VALID or
INVALID with structured rejection reasons.

### LabelCandidateScorer

Assigns composite scores (0–1) to VALID candidates using configurable
weights. Produces sorted output: VALID candidates first (by descending
score), then INVALID candidates (for diagnostics). Exposes component
scores.

## Created files

- `src/core/labels/types.ts` (extended)
- `src/core/labels/CandidateCollisionQuery.ts`
- `src/core/labels/LabelCandidateGenerator.ts`
- `src/core/labels/LabelCandidateValidator.ts`
- `src/core/labels/LabelCandidateScorer.ts`
- `tests/unit/labels/LabelCandidateGenerator.test.ts` — 13 tests
- `tests/unit/labels/LabelCandidateScorer.test.ts` — 9 tests
- `tests/unit/labels/LabelCandidateValidator.test.ts` — 8 tests
- `docs/architecture/milestone-7.2-architecture.md`
- `docs/traceability/milestone-7.2-matrix.md`
