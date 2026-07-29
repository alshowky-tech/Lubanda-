# Milestone 4.1.2 completion report

## Scope

Milestone 4.1.2 integrates deterministic label placement with accepted skeleton
geometry. It adds no rendering, export, UI, persistence, AI, Arabic
shaping/text measurement, or incremental reflow.

## Implemented

- Deterministic selection of one anchor branch for each unique person,
  including multi-segment trunk owners.
- Twenty-four candidates per person from three Bézier positions and eight
  directions.
- Stable candidate identities and deterministic score/ordinal ordering.
- Convex and concave polygon boundary filtering with label clearance.
- Densified skeleton sampling into tapered wood obstacles with bark allowance.
- Wood/label and label/label clearance through the existing collision and
  assignment engines.
- `ACCEPTED` and `PARTIAL` results with metrics.
- One evidence-bearing `LABEL_UNRESOLVED` diagnostic per unplaced person.
- Public exports for candidate generation and integrated layout.

## Corrective findings resolved

The base commit provided candidate assignment and AABB collision primitives but
did not connect them to `SkeletonPlan`, did not derive anchors, did not build
wood obstacles, did not enforce the template boundary, and did not produce
unresolved-label diagnostics. It also had no skeleton-to-label integration
test. These were acceptance blockers for Milestone 4.1.2 and are resolved in
this delivery.

## Acceptance gates

| Gate | Result |
|---|---|
| Strict TypeScript | PASS |
| ESLint | PASS |
| Vitest | PASS — 34 files, 140 passed, 1 intentionally skipped |
| Deterministic replay | PASS |
| Convex/concave boundary checks | PASS |
| Skeleton → labels integration | PASS |
| Unresolved-label diagnostics | PASS |
| Rendering/export/UI/AI added | NO |
