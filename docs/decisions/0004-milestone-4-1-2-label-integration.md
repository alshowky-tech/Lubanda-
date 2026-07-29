# ADR 0004 — Milestone 4.1.2 label integration

## Status

Accepted.

## Decision

Milestone 4.1.2 consumes an accepted `SkeletonPlan`, its matching
`GenealogyGraph`, a polygon template boundary, and the validated engine
configuration. It does not mutate genealogy or skeleton geometry.

One label is requested for every unique person represented by the skeleton.
When a person owns multiple skeleton segments (notably the root/trunk), the
segment with the greatest deterministic `branchIndex` is the anchor source.

For every person, the generator evaluates three points on the selected cubic
Bézier branch (`t = 1`, `0.75`, and `0.5`) and eight deterministic directions.
Candidate identity includes person, anchor site, and direction. Label bounds
include the configured character estimate, padding, minimum font size, and
bounded readable rotation.

The template boundary is a hard constraint. Label bounds are expanded by label
clearance before rectangle corners, boundary crossings, and concave intrusions
are checked prior to assignment.

Wood is represented by a deterministic, densified sampling of every skeleton
curve. Each sample uses interpolated branch thickness plus bark allowance.
The existing `LabelCollisionQuery` and `LabelAssignmentEngine` then enforce
wood/label and label/label clearance.

Failure to place a label does not modify the genealogy or skeleton. The result
is `PARTIAL` and contains one `LABEL_UNRESOLVED` warning per person, including
candidate and collision evidence.

## Consequences

- Output is independent of input branch ordering.
- Internal persons can use mid-branch anchors when a child junction blocks the
  terminal anchor.
- Multiple trunk segments do not create duplicate person candidates.
- Boundary and wood safety remain conservative because assignment uses
  axis-aligned label bounds.
- Rendering, export, UI, AI, persistence, Arabic shaping/text measurement, and
  incremental stability remain outside this milestone.
