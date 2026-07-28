# Lubanda Core v1 — Milestone 2 completion report

Date: 2026-07-28  
Status: complete, awaiting explicit Milestone 3 approval

## Scope delivered

Demand computation, territory DTO/runtime separation, deterministic initial
allocation, bounded negotiation and contiguous-area transfer, preliminary
corridor and junction reservations, blocking validation, engineering
diagnostics, automated tests, schemas, architecture, configuration reference,
traceability, and benchmark evidence.

No genealogy was modified. No skeleton growth, final branch routing, collision
solver, labels, UI, bark, leaves, ornament, artistic template, AI rendering, or
export module was created.

## Baseline verification

The standalone Milestone 1 ZIP passed ZIP integrity and every one of its 93
manifest hashes. Archive SHA-256:
`51a3be191ec9e41f17dcc0e222db183a1d8fad2a72117989c9d8646cd81b272a`.
See `docs/milestone-1-baseline-verification.md`.

## Quality gates

| Gate | Result |
|---|---|
| Type-check | PASS — `tsc --noEmit` |
| Lint | PASS — `eslint .` |
| Unit | PASS — 18 files, 69 tests |
| Property | PASS — 4 files, 6 tests |
| Integration | PASS — 4 files, 15 tests with official-workbook environment |
| Schema parity | PASS — 1 file, 7 tests |
| Official import/validation | PASS — 1,386 accepted, zero issues |
| Official deterministic replay | PASS — byte-identical |
| Diagnostic generation | PASS |

The schema suite is a focused subset of unit tests and is not added again to
the unique total.

## Official workbook result

| Metric | Result |
|---|---:|
| Selected root | `1` |
| Included people | 1,386 |
| Major lineages | 2 |
| Total person demand | 7,445,665.345678 |
| Lineage `2` demand / territory area | 4,416,879.935354 / 13,625,566.0281 |
| Lineage `487` demand / territory area | 3,028,485.917578 / 10,034,913.838092 |
| Negotiation | not required, 0 iterations |
| Validation | accepted, zero blocking issues |
| Runtime | 344.396 ms |
| Peak RSS approximation | 154,914,816 bytes |
| Canonical serialized size | 6,101 bytes |
| Replay checksum | `ead61913298aa8e41cde2cb2fe30db6e9056076106a8c6f1cbc8d67f02a34b02` |

The detailed machine-readable record is
`artifacts/official-milestone-2-benchmark.json`.

## Created files

- `INDEX.md`
- `artifacts/milestone-2-territory-diagnostic.svg`
- `artifacts/official-milestone-2-benchmark.json`
- `docs/architecture/milestone-2-architecture.md`
- `docs/architecture/milestone-2-dependency-graph.md`
- `docs/catalogs/milestone-2-issues-and-diagnostics.md`
- `docs/configuration/milestone-2-configuration.md`
- `docs/decisions/0002-milestone-2-contract-extension.md`
- `docs/milestone-1-baseline-verification.md`
- `docs/milestone-2-completion-report.md`
- `docs/milestone-2-known-limitations.md`
- `docs/milestone-3-proposed-file-plan.md`
- `docs/traceability/milestone-2-matrix.md`
- `schemas/demand-plan.schema.json`
- `schemas/territory-plan.schema.json`
- `scripts/benchmark-official-territories.ts`
- `scripts/generate-territory-diagnostic-svg.ts`
- `src/core/demand/DemandEngine.ts`
- `src/core/demand/index.ts`
- `src/core/demand/types.ts`
- `src/core/determinism/canonical-json.ts`
- `src/core/determinism/index.ts`
- `src/core/determinism/numeric.ts`
- `src/core/diagnostics/DiagnosticCollector.ts`
- `src/core/diagnostics/index.ts`
- `src/core/territory/CorridorPlanner.ts`
- `src/core/territory/TerritoryPlanner.ts`
- `src/core/territory/TerritoryValidator.ts`
- `src/core/territory/index.ts`
- `src/core/territory/polygon-geometry.ts`
- `src/core/territory/power-diagram.ts`
- `src/core/territory/runtime.ts`
- `src/core/territory/template-boundary.ts`
- `src/core/territory/types.ts`
- `tests/helpers/territory-builders.ts`
- `tests/integration/territory-scenarios.test.ts`
- `tests/property/territory.property.test.ts`
- `tests/unit/demand/DemandEngine.test.ts`
- `tests/unit/territory/TerritoryPlanner.test.ts`

`artifacts/milestone-2-sha256-manifest.json` is generated after this report and
is also a created delivery file.

## Modified Milestone 1 files

- `README.md`
- `configs/default-engine-configuration.json`
- `package-lock.json`
- `package.json`
- `schemas/engine-configuration.schema.json`
- `schemas/error-codes.schema.json`
- `scripts/generate-file-manifest.ts`
- `src/core/config/defaults.ts`
- `src/core/config/types.ts`
- `src/core/config/validate-configuration.ts`
- `src/core/contracts/diagnostics.ts`
- `src/core/contracts/identifiers.ts`
- `src/core/contracts/issues.ts`
- `src/core/contracts/solve-stage.ts`
- `src/index.ts`
- `tests/helpers/genealogy-builders.ts`
- `tests/unit/contracts/schema-parity.test.ts`

`artifacts/official-workbook-validation.json` was regenerated and remained
byte-identical to the Milestone 1 evidence.

## Acceptance semantics

The planner returns `StageResult` failure when any blocking geometry,
allocation, negotiation, corridor, ownership, containment, or serialization
issue remains. Only an accepted plan receives a plan ID and deterministic
fingerprint. No runtime map is present in persisted output.

## Known limitations and next milestone

Known limitations are recorded in `docs/milestone-2-known-limitations.md`.
The exact proposed, unimplemented Milestone 3 file plan is in
`docs/milestone-3-proposed-file-plan.md`. Milestone 3 must not begin without
explicit approval.
