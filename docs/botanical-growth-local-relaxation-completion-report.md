# Botanical Growth Engine — local relaxation completion report

## Scope

This increment implements the first deterministic Space Optimization / Local
Relaxation pass after accepted skeleton growth and label layout.

It does not add bark, leaves, AI, UI, persistence, manual editing, or
incremental reflow.

## Implemented

- Provenance checks for matching accepted skeleton and territory plans.
- Deterministic branch ordering and bounded, decaying relaxation steps.
- Territory-centroid attraction for non-trunk Bézier control points.
- Locked endpoints, nodes, junctions, topology, branch identity, and genealogy.
- Full skeleton validation after every proposed batch.
- Full label layout validation after every geometrically valid batch.
- Fixed-label preservation with per-branch rejection of newly introduced wood
  clearance collisions.
- Golden Dataset visual proof: BEFORE/AFTER SVG and PNG plus a moved-branch
  overlay.
- Atomic proposal rejection on any hard-constraint failure.
- Score-based acceptance using mean territory distance.
- Immutable iteration diagnostics, before/after metrics, and SHA-256
  fingerprints for relaxed skeletons and results.

## Acceptance gates

| Gate | Result |
|---|---|
| Source genealogy mutation | Prohibited and unchanged |
| Branch endpoint movement | None |
| Topology or branch identity change | None |
| Boundary and intersection validation | Required for every accepted iteration |
| Label layout acceptance | Required by default |
| Deterministic replay | Covered |
| Reordered branch input | Covered |
| Source plan mutation | Covered |
| Golden Dataset | 1,386 people; 1,388 branches |
| Visually moved branches | 1,317 |
| Genealogy/topology/endpoints/labels | Unchanged |

## Deferred Botanical Growth Engine work

- collision-envelope repulsion forces;
- empty-region attractors and broader canopy-utilization metrics;
- prior-layout stability forces;
- user locks and bounded manual adjustments;
- incremental reflow;
- performance profiling on the official 1,387-person dataset.
