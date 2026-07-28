# ADR 0003 — Milestone 3 Skeleton Growth Contract

**Date:** 2026-07-28  
**Status:** accepted  
**Deciders:** Lubanda engineering

---

## Context

Milestone 2 established demand computation and territory allocation. The
next phase requires a deterministic skeleton (branch centerline) structure
that can be validated, frozen, and later consumed by routing and collision
engines. No routing, collision solving, labels, AI, or rendering exists yet.

## Decision

### 1. Skeleton types live in `src/core/skeleton/`

A new package parallel to `territory/`, `demand/`, etc. Its types define
`SkeletonNode`, `SkeletonBranch`, `TrunkSkeleton`, `SkeletonPlan`, and
supporting types. The contract is in `types.ts` and the public API is in
`index.ts`.

### 2. Trunk structure is explicit, not implicit

The trunk is a first-class `TrunkSkeleton` object with `baseNodeId`,
`terminalNodeId`, `segments` (list of branch IDs), `length`, and
`centroid`. This allows the trunk to be inspected without traversing the
branch graph.

### 3. Junction mapping is explicit

`MappedJunction` records connect territory-plan junction zones to trunk
nodes. Each maps a `junctionZoneId`, `trunkNodeId`, `lineageRootId`,
`trunkPoint`, and `corridorId`. This creates an explicit bridge between
territory and skeleton domains.

### 4. Recursive growth follows genealogy, not territory topology

Growth traverses the genealogy tree in person order. Each person receives
a branch segment. Branch targets default to territory centroids for
major-lineage roots and extend in the parent direction for deeper
persons. This ensures every person in the selected-root subtree has a
branch, even when territory plans only cover top-level lineages.

### 5. Candidates are generated with seeded control-point jitter

Each branch has `candidateCount` Bezier candidates. Control points use
`stableUnit()` with context-specific keys and the configured integer seed.
This guarantees deterministic output without storing random state.

### 6. Hard rejection is distinct from scoring

Rejection (5 checks: too short, excessive curvature, out of bounds,
territory boundary crossed, branch intersection) removes invalid
candidates before scoring. Scoring uses 5 weighted metrics. Only
post-rejection valid candidates are scored.

### 7. Validation is separate from growth

`SkeletonValidator` in `src/core/layout/` checks structural integrity
(parent chains, node references, template containment, intersections)
without re-executing growth logic. This separation allows independent
testing and later re-validation by downstream consumers.

### 8. The frozen plan is read-only

`FreezeSkeleton` deep-freezes every nested object. The deterministic
fingerprint (SHA-256 of canonical JSON) is computed by the growth engine
before freezing.

### 9. No routing or collision concerns

Branch thickness, clearance envelopes, swept paths, and intersection
repair are out of scope. These are Milestone 4+ responsibilities.

## Consequences

- Positive: clear separation of concerns prevents scope creep
- Positive: explicit trunk and junction mapping simplifies later routing
- Positive: every person in the selected-root subtree gets a branch
- Positive: seeded determinism enables byte-identical replay
- Risk: fallback branches (when all candidates are rejected) may produce
  less organic curves — mitigated by generous candidate counts
- Risk: the validator runs after the engine but does not block the plan
  in the current implementation — validation is advisory for now

## Alternatives considered

- **Flat skeleton without trunk/junction distinction** — rejected because
  downstream routing needs to know which segments form the main spine
- **Single candidate with fixed control points** — rejected because it
  produces machine-like branches; multiple candidates with scoring
  produces organic variation
- **Validation integrated into the engine** — rejected to keep the engine
  focused on growth and validation independently extensible
- **Thick skeleton with implicit clearance** — rejected because
  thickness is a visual parameter, not a routing constraint
