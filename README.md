# Lubanda Core — Botanical Growth Engine

This repository preserves the accepted genealogy, territory, and skeleton
foundations and implements Milestone 4.1.2 — Label Integration with Skeleton
Geometry:

`Accepted Skeleton → Deterministic Label Anchors → Boundary Filtering → Wood/Label Collision Queries → Candidate Assignment → Unresolved-Label Diagnostics`

The latest increment adds deterministic local relaxation after accepted
skeleton and label layout. It intentionally contains no production renderer,
UI, persistence layer, AI adapter, Arabic shaping engine, or incremental
reflow.

## Pipeline

```
Accepted Territory Plan
    ↓
Trunk Centerline (root entry → junctions → canopy)
    ↓
Junction Mapping (territory junctions → trunk nodes)
    ↓
Recursive Skeleton Growth (per person in genealogy subtree)
    ↓
Branch Candidate Generation (seeded cubic Bezier curves)
    ↓
Hard Candidate Rejection (length, curvature, bounds, intersection)
    ↓
Deterministic Candidate Scoring (smoothness, naturalness, direction, length, attractor)
    ↓
Best Candidate Selection
    ↓
Skeleton Validation (structural checks)
    ↓
Deterministic Label Layout
    ↓
Botanical Local Relaxation (bounded Bézier control-point movement)
    ↓
Hard Geometry + Label Revalidation
    ↓
Frozen Relaxed Skeleton Plan (deep-frozen DTO + SHA-256 fingerprint)
```

## Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run test:unit
npm run test:property
npm run test:integration
npm run test:schema
npm run diagnostic:svg
npm run diagnostic:territory-svg
npm run diagnostic:skeleton-svg
npm run validate:official
npm run benchmark:official
```

## Governing documents

- The Lubanda Bible — Official First Edition
- Lubanda Core Specification v1.0
- Approved Core v1 contract clarifications dated 2026-07-27
- ADR 0003 — Milestone 3 Skeleton Growth Contract

## Milestone 4.1.2 label integration

The integration layer selects one deterministic terminal branch per person,
generates 24 geometry-derived candidates at three positions along that branch,
rejects candidates outside concave or convex template boundaries, converts the
sampled skeleton (including bark allowance and taper) into wood obstacles, and
assigns non-overlapping labels. A partial result carries one deterministic
`LABEL_UNRESOLVED` diagnostic per unplaced person.

See `docs/milestone-4-1-2-completion-report.md` for the acceptance evidence and
scope exclusions.

## Botanical local relaxation

The first Space Optimization increment moves only interior Bézier control
points toward their assigned territory centroids. Endpoints, junctions,
topology, branch identity, and genealogy remain locked. Each deterministic
batch is accepted only when its score improves and complete skeleton and label
validation still pass.

The Golden Dataset proof keeps all 1,386 label placements fixed and highlights
each moved branch in a deterministic overlay. Run it with:

```bash
npm run golden:e2e -- /path/to/golden-dataset.xlsx
```

See `docs/botanical-growth-local-relaxation-completion-report.md` and ADR 0005.
