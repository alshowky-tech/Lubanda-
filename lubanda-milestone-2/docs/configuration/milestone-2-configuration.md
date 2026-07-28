# Milestone 2 configuration reference

## Demand

| Field | Default | Contract |
|---|---:|---|
| `subtreeSizeWeight` | 1 | Square-root subtree contribution |
| `directChildCountWeight` | 1.25 | Direct branching contribution |
| `terminalCountWeight` | 0.75 | Terminal-person contribution |
| `maxDepthWeight` | 1 | Subtree-depth contribution |
| `branchEntropyWeight` | 0.5 | Balanced branching-complexity contribution |
| `labelWeight` | 1 | Estimated label-area multiplier |
| `routingClearanceWeight` | 1 | Wood/routing clearance multiplier |
| `estimatedCharacterWidth` | 8 | Label estimate, coordinate units |
| `estimatedLabelHeight` | 18 | Label estimate, coordinate units |
| `personPadding` | 12 | Per-person padding |
| `safetyMargin` | 8 | Safety clearance |
| `woodClearance` | 10 | Preliminary wood allowance |
| `minimumArea` / `maximumArea` | 400 / 10,000,000 | Per-person pre-weight clamp |
| `minimumDemand` / `maximumDemand` | 1 / 10,000 | Score clamp |
| `lineageWeights` | `{}` | Explicit person-ID multiplier; absent means 1 |
| `roundingDecimalPlaces` | 6 | DTO rounding |

## Territory

| Field | Default | Contract |
|---|---:|---|
| `maxNegotiationIterations` | 40 | Hard deterministic iteration limit |
| `minimumCorridorWidth` | 24 | Required reservation width |
| `minimumCorridorLength` | 8 | Required usable centerline length |
| `corridorClearance` | 8 | Territory interior inset |
| `minimumTerritoryArea` | 2,500 | Major-lineage floor |
| `boundaryMargin` | 24 | Template inset |
| `junctionZoneRadius` | 36 | Reserved junction disk radius |
| `rootEntryWidth` / `rootEntryDepth` | 72 / 96 | Root/trunk reservation |
| `maximumAreaErrorRatio` | 0.12 | Accepted allocation error |
| `convergenceTolerance` | 0.0025 | Solver improvement threshold |
| `seedJitter` | 0.18 | Bounded deterministic site asymmetry |
| `boundarySamplingPoints` | 64 | Ellipse/arch sampling |
| `maximumFragmentCount` | 1 | v1 requires connected single fragments |
| `roundingDecimalPlaces` | 6 | DTO coordinate/metric rounding |

The JSON Schema rejects unknown fields and schema-parity tests compare the
typed default to `configs/default-engine-configuration.json`.
