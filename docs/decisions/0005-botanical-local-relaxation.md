# ADR 0005 — Botanical local relaxation

## Status

Accepted for the first Botanical Growth Engine optimization increment.

## Context

The accepted skeleton and label pipeline can produce a valid layout, but the
canonical pipeline still requires a relaxation stage that improves organic
spacing without weakening hard constraints. The initial increment must remain
small, deterministic, and independently reversible.

## Decision

The local relaxation engine:

- consumes matching accepted genealogy, territory, and skeleton plans;
- never changes genealogy, branch identity, endpoints, nodes, junctions, or
  parent/child topology;
- moves only the two interior control points of eligible non-trunk cubic
  Bézier branches;
- attracts each eligible branch toward the centroid of its assigned territory;
- bounds and deterministically rounds every proposed movement;
- uses a decaying step schedule with a fixed iteration limit;
- validates the complete skeleton after every batch proposal;
- recomputes label layout after geometrically valid proposals only when fixed
  label preservation is explicitly disabled;
- preserves accepted label placements by default and removes any unsafe branch
  proposal from a batch before validation;
- rejects the complete batch when geometry, boundary, or required label
  acceptance fails;
- accepts a batch only when mean territory distance improves; and
- produces new deterministic skeleton and result fingerprints without mutating
  the accepted source plan.

This is a constrained optimization pass, not a renderer and not a new skeleton
growth algorithm.

## Consequences

- Accepted branch attachments remain exact.
- A failed proposal cannot leak partial geometry into the result.
- Reordered branch input produces identical output.
- Recovery-generated branches inherit the territory of their recorded lineage
  root when they do not carry a direct territory identifier.
- The first increment adds the territory-attraction force and the hard
  acceptance envelope. Repulsion, stability-to-prior-layout, editable locks,
  and incremental reflow remain later increments.
