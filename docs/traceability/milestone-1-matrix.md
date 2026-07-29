# Milestone 1 Traceability Matrix

| Requirement | Specification | Implementation | Evidence |
|---|---|---|---|
| Typed IDs and stage results | LCS-DOM-001, LCS-ARC-002 | `src/core/contracts` | contract and type-check tests |
| Typed demand configuration | LCS-DOM-005, approved clarification 2 | `src/core/config`, `schemas/engine-configuration.schema.json` | schema parity tests |
| Safe workbook acquisition | LNGP-R2-02, LCS-CON-001 | `src/core/import` | ZIP preflight, constrained OOXML parser, import unit/integration tests |
| NFC and numeral normalization | LNGP-R2-04, clarification 9 | `src/core/genealogy/normalize.ts`, `numerals.ts` | normalization tests |
| Canonical SHA-256 | clarification 10 | `src/core/genealogy/checksum.ts` | checksum and replay tests |
| Blocking validation and snapshot gate | LNGP-R2-03, clarification 1 | `src/core/validation`, `genealogy/snapshot.ts` | issue-code, rejected-snapshot, and lifecycle tests |
| No automatic repair | LNGP-R2-03, clarification 13 | import and validator boundaries | mutation/repair tests |
| Serializable snapshot/runtime graph split | clarification 3 | `genealogy/types.ts`, `graph.ts` | serialization and graph tests |
| Strict generations | clarification 4 | `validation/validator.ts` | generation tests |
| Root policy and render scope | clarification 5 | `validation/policy.ts`, `genealogy/scope.ts` | root and scope tests |
| Geometry predicates | LCS-GEO-001, clarification 11 | `src/core/geometry` | unit/property tests and validated diagnostic SVG |
| Deterministic SpatialHash | LCS-GEO-003, clarification 12 | `src/core/spatial` | unit/property tests and validated diagnostic SVG |
