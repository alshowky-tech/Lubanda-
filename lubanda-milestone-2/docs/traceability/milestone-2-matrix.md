# Milestone 2 traceability matrix

| Requirement | Implementation | Automated evidence |
|---|---|---|
| Bottom-up demand, deep-safe | `src/core/demand/*` | `tests/unit/demand/DemandEngine.test.ts` |
| Serializable demand/config metadata | demand DTO + schema | schema-parity and replay tests |
| Flexible territory DTO/runtime split | `src/core/territory/types.ts`, `runtime.ts` | schema and validator tests |
| Selected-root proportional allocation | `TerritoryPlanner.ts`, `power-diagram.ts` | territory scenario tests |
| Deterministic negotiation/area transfer | `negotiatePowerCells`, `partitionConvexPolygonByDemand` | convergence/failure/property tests |
| Connected, valid, single-fragment regions | polygon clipping + blocking validator | invalid geometry and property tests |
| Preliminary corridor/junction reservation | `CorridorPlanner.ts` | planner and narrow-corridor tests |
| Blocking acceptance gate | `TerritoryValidator.ts`, stage failure | unit and integration tests |
| No runtime maps persisted | recursive serialization guard | validator/schema tests |
| Byte-identical replay | canonical JSON/SHA-256 | replay/property/official benchmark |
| Engineering diagnostic | territory SVG script | generated SVG artifact |
| 10/100/500/1,000 scale | synthetic scenario suite | `territory-scenarios.test.ts` |
| Official 1,386 dataset | benchmark script | benchmark JSON artifact |
| M1 behavior preserved | all M1 suites retained | full unit/property/integration run |
| No M3/art/UI/export | package surface/file audit | manifest and completion report |
