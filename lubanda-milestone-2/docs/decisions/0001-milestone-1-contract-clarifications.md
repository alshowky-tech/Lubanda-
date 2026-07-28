# ADR-0001 — Milestone 1 Contract Clarifications

Status: Accepted  
Date: 2026-07-27

## Decision

1. Import lifecycle is Acquire → Normalize → Validate → Build Accepted
   GenealogySnapshot → Commit Revision. Blocking issues prevent snapshot and
   revision creation.
2. `EngineConfiguration` contains a typed and schema-validated `demand` section.
3. `GenealogySnapshot` is serializable. `GenealogyGraph` is runtime-only and may
   use maps; runtime maps are never persisted.
4. Core v1 generations are strict integers. Roots equal the configured baseline;
   children equal parent generation plus one.
5. Import preview may contain multiple roots. `ValidationPolicy` controls their
   severity. Rendering later requires one selected root. Other roots are outside
   the selected render scope, not unreachable errors.
6. `MALFORMED_VALUE` is canonical.
7. Internal severities are `FATAL`, `ERROR`, `WARNING`, and `INFO`.
8. Canonical ordering is explicit display order, source row, normalized ID.
9. Stored text is NFC. Search normalization is separate and non-destructive.
10. Source checksums use canonical normalized rows, canonical ordering, stable
    keys and nulls, UTF-8, and SHA-256.
11. Geometry semantics are defined in `geometry-semantics.md`.
12. Spatial hash semantics are defined in `spatial-hash-semantics.md`.
13. Only safe normalization is automatic; genealogy is never repaired.
14. All Milestone 1 contracts are typed before use.
15. The Bible manifest discrepancy is deferred to its next documentation
    revision and does not change the original package in this milestone.

## Consequences

- Invalid normalized data remains inspectable through import and validation
  reports but cannot become an accepted snapshot.
- Runtime graph performance does not compromise persistence compatibility.
- Later layout engines inherit deterministic data and geometry foundations.

