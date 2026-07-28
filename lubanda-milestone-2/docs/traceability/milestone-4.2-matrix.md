# Milestone 4.2 — Traceability Matrix

| ID | Requirement | Source | Implementation | Test(s) | Status |
|---|---|---|---|---|---|
| M4.2-1 | Collision types and contracts | LCS-CON-004 | `src/core/collision/types.ts` | — | ✅ |
| M4.2-2 | Collision index (spatial hash over branch envelopes) | LCS-GEO-004, LCS-GEO-003 | `src/core/collision/CollisionIndex.ts` | CollisionEngine.test.ts | ✅ |
| M4.2-3 | Broad phase: query spatial index by envelope bounds | LCS-GEO-004 | `CollisionIndex.ts` — SpatialHash.query | ConstraintSolver.test.ts, CollisionEngine.test.ts | ✅ |
| M4.2-4 | Narrow phase: adaptive curve-to-curve distance | LCS-GEO-004 | `src/core/collision/ConstraintSolver.ts` — `polylineMinDistance` | ConstraintSolver.test.ts | ✅ |
| M4.2-5 | Collision envelope radius formula | LCS-GEO-004 | `src/core/routing/ClearanceModel.ts` — `computeEnvelopeRadius` | ClearanceModel.test.ts | ✅ |
| M4.2-6 | Adjacent parent-child exemption | LCS-GEO-004 | `ConstraintSolver.ts` — `isAdjacentExempt` | ConstraintSolver.test.ts | ✅ |
| M4.2-7 | Self-collision testing for long curves | LCS-GEO-004 | `ConstraintSolver.ts` — `testSelfCollision` | ConstraintSolver.test.ts | ✅ |
| M4.2-8 | Boundary containment testing | LCS-GEO-005 | `ConstraintSolver.ts` — `testBoundaryContainment` | ConstraintSolver.test.ts | ✅ |
| M4.2-9 | `CollisionEngine.index()` | LCS-CON-004 | `src/core/collision/CollisionEngine.ts` | CollisionEngine.test.ts | ✅ |
| M4.2-10 | `CollisionEngine.testCandidate()` | LCS-CON-004 | `CollisionEngine.ts` — `testCandidate` | CollisionEngine.test.ts | ✅ |
| M4.2-11 | `CollisionEngine.validateLayout()` | LCS-CON-004 | `CollisionEngine.ts` — `validateLayout` | CollisionEngine.test.ts, skeleton-to-collision.test.ts | ✅ |
| M4.2-12 | `CollisionTestResult` type | LCS-CON-004 | `types.ts` — `CollisionTestResult` | CollisionEngine.test.ts | ✅ |
| M4.2-13 | `CollisionRecord` with all required fields | LCS-CON-004 | `types.ts` — `CollisionRecord` | ConstraintSolver.test.ts, CollisionResolver.test.ts | ✅ |
| M4.2-14 | Local repair (not global solver) | LCS-IMP-002 | `src/core/collision/CollisionResolver.ts` — `resolveLocalCollisions` | CollisionResolver.test.ts | ✅ |
| M4.2-15 | Resolution scope assignment per preferred order | LNGP-R3-05 §6 | `CollisionResolver.ts` — `mapSeverityToScope` | CollisionResolver.test.ts | ✅ |
| M4.2-16 | Exact final validation with stricter tolerance | LCS-GEO-004 | `CollisionEngine.ts` — `validateLayout` with `finalValidationTolerance` | CollisionEngine.test.ts | ✅ |
| M4.2-17 | Canonical clearance formula shared with routing | LCS-GEO-004, LCS-CON-004 | `ClearanceModel.ts` — `computeEnvelopeRadius` | ClearanceModel.test.ts | ✅ |
| M4.2-18 | Consume RoutingPlan corridor data | Stakeholder | `types.ts` — `CollisionInput.routingPlan` | CollisionEngine.test.ts, skeleton-to-collision.test.ts | ✅ |
| M4.2-19 | No skeleton mutation by local repair | LCS-GOV-001 §5 | `CollisionResolver.ts` — pure function, input freezing | CollisionResolver.test.ts | ✅ |
| M4.2-20 | Maximum repair iterations | Stakeholder | `types.ts` — `CollisionPolicy.maximumRepairIterations` | CollisionResolver.test.ts | ✅ |
| M4.2-21 | `CollisionPolicy` type with configurable thresholds | LCS-CON-004 | `types.ts` — `CollisionPolicy` | CollisionResolver.test.ts | ✅ |
| M4.2-22 | `CollisionValidationReport` with metrics | LCS-CON-004 | `types.ts` — `CollisionValidationReport`, `CollisionValidationMetrics` | CollisionEngine.test.ts, collision.property.test.ts | ✅ |
| M4.2-23 | `CollisionValidationReport` schema | LCS-TST-005 | `schemas/collision-report.schema.json` | schema-parity.test.ts | ✅ |
| M4.2-24 | Collision issue codes | LCS-CON-004 | `src/core/contracts/issues.ts` — `COLLISION_ISSUE_CODES` | schema-parity.test.ts | ✅ |
| M4.2-25 | Collision stages in solve pipeline | LCS-ARC-002 | `src/core/contracts/solve-stage.ts` — `MILESTONE_4_2_STAGES` | — | ✅ |
| M4.2-26 | Error codes schema updated | LCS-TST-005 | `schemas/error-codes.schema.json` | schema-parity.test.ts | ✅ |
| M4.2-27 | Deterministic collision reports | LCS-TST-005 Gate 6 | `CollisionEngine.ts`, `CollisionResolver.ts` — sorted outputs | collision.property.test.ts | ✅ |
| M4.2-28 | Unit tests: ClearanceModel | LCS-GOV-001 §7 | `tests/unit/collision/ClearanceModel.test.ts` — 10 tests | ✅ | ✅ |
| M4.2-29 | Unit tests: CollisionEngine | LCS-GOV-001 §7 | `tests/unit/collision/CollisionEngine.test.ts` — 13 tests | ✅ | ✅ |
| M4.2-30 | Unit tests: ConstraintSolver | LCS-GOV-001 §7 | `tests/unit/collision/ConstraintSolver.test.ts` — 11 tests | ✅ | ✅ |
| M4.2-31 | Unit tests: CollisionResolver | LCS-GOV-001 §7 | `tests/unit/collision/CollisionResolver.test.ts` — 12 tests | ✅ | ✅ |
| M4.2-32 | Property tests: determinism, symmetry, valid values | LCS-TST-005 | `tests/property/collision.property.test.ts` — 7 tests | ✅ | ✅ |
| M4.2-33 | Integration test: skeleton→routing→collision | LCS-TST-005 | `tests/integration/skeleton-to-collision.test.ts` — 5 tests | ✅ | ✅ |
| M4.2-34 | Architecture document | LCS-GOV-001 §7 | `docs/architecture/milestone-4.2-architecture.md` | — | ✅ |
| M4.2-35 | Traceability matrix | LCS-GOV-001 §7 | `docs/traceability/milestone-4.2-matrix.md` | — | ✅ |

## Quality gates

| Gate | Result |
|---|---|
| Type-check (`tsc --noEmit`) | ✅ PASS |
| All tests (`vitest run`) | ✅ All pass, 0 regressions |
| Schema parity | ✅ All schemas compile and validate |
| Deterministic replay | ✅ Byte-identical reports on repeat |
| No forbidden crossings in accepted layouts | ✅ Gate 3 verified by property test |

## Test breakdown

| Suite | Files | Tests | Status |
|---|---|---|---|
| Unit (collision) | 4 | 46 | ✅ |
| Property (collision) | 1 | 7 | ✅ |
| Integration (collision) | 1 | 5 | ✅ |
| Pre-existing (all milestones) | 31 | 150 | ✅ (no regression) |
| Schema parity | 1 | 8 (+1 new) | ✅ |
| **Total** | **38** | **217** | **✅ All pass (1 pre-existing skip)** |
