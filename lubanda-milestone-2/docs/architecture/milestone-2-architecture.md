# Milestone 2 architecture

## Authority and boundary

The accepted `GenealogySnapshot` is immutable truth. `GenealogyGraph` is a
runtime-only index. Milestone 2 reads the selected-root subtree and never
changes people, parentage, generation, canonical order, or the snapshot.

The implemented pipeline is:

1. compute iterative bottom-up demand;
2. reserve template margins and root/trunk entry;
3. allocate one territory per selected root child;
4. negotiate weighted power cells, with a deterministic contiguous-area
   transfer fallback for difficult cases;
5. reserve preliminary entry corridors and junction zones;
6. run the blocking territory gate;
7. hash the canonical serializable accepted DTO.

No rejected plan is returned as accepted or assigned a committed plan ID.

## Demand algorithm

An explicit expanded-node stack creates canonical postorder without recursion.
Each person receives raw descendant, child, depth, terminal, label-footprint,
entropy, and complexity statistics. Derived demand combines configured label,
wood/routing, padding/safety, minimum-area, and optional lineage-weight terms.
The plan records the exact configuration, algorithm version, order indexes,
stack high-water mark, and SHA-256 fingerprint.

## Territory algorithm

Template inputs are polygon, sampled ellipse, or sampled arch regions. The
current allocator requires the resulting polygon to be simple and convex. It
insets the boundary, removes the root-entry depth from allocatable space, and
places seeded power sites in canonical child order. Additive power weights
rebalance area within a configured iteration budget.

If the power solver would leave an empty cell, deterministic area transfer cuts
the convex remaining region along a seeded oblique axis. This creates
proportional, contiguous, single-fragment, two-dimensional polygons. It is not
radial, angular, generation-banded, or fixed-generation allocation.

## Corridors and validation

Corridors are reservation DTOs only: a root-entry point, a contained circular
junction, and a territory interior target. They are not final branch
centerlines. Validation blocks non-finite or invalid polygons, containment,
minimum area, overlap, ownership, parent relation, corridor width/length,
reservation containment, missing connections, runtime collections, and
serialization failures.

## Determinism

- child/candidate order: canonical genealogy order;
- neighbor/negotiation order: territory array order;
- ties: stable identifier plus configured integer seed;
- vertices: counter-clockwise, rotated to lowest `(y,x)`;
- floats: configured decimal rounding before DTO storage;
- diagnostics: monotonic logical sequence, never wall-clock time;
- serialization: lexicographically stable object keys, explicit JSON nulls;
- checksum: UTF-8 canonical JSON, SHA-256.

## Serializable/runtime separation

`DemandPlan`, `TerritoryPlan`, polygons, corridors, reservations, diagnostics,
and validation reports are DTOs. Runtime lookup `Map` objects live only in
`GenealogyGraph`, demand computation, validation, or `TerritoryRuntimeIndex`.
The acceptance gate recursively rejects `Map`, `Set`, weak collections, and
non-JSON-serializable candidate state.
