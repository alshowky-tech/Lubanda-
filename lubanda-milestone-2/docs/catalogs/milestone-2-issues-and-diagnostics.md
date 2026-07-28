# Milestone 2 issue and diagnostic catalog

All blocking issues use internal `ERROR` severity. Presentation localization is
outside Core.

| Code | Blocking meaning |
|---|---|
| `DEMAND_CONFIG_INVALID` | Demand configuration is unusable |
| `TEMPLATE_INVALID` | Boundary is non-finite, degenerate, non-simple/non-convex, or cannot reserve root entry |
| `TERRITORY_MISSING` | Included major lineage has no territory |
| `TERRITORY_INVALID_GEOMETRY` | Empty, degenerate, disconnected, non-finite, or non-simple territory/envelope |
| `TERRITORY_OUT_OF_BOUNDS` | Territory escapes template |
| `TERRITORY_AREA_INSUFFICIENT` | Required/configured minimum area is unmet |
| `TERRITORY_OVERLAP` | Territory interiors overlap |
| `TERRITORY_OWNERSHIP_CONFLICT` | A lineage owns multiple territories |
| `TERRITORY_RELATION_INVALID` | Parent/child or corridor target is invalid |
| `CORRIDOR_INVALID` | Missing, zero-length, impossible, or malformed corridor |
| `CORRIDOR_TOO_NARROW` | Width is below configuration |
| `CORRIDOR_OUT_OF_BOUNDS` | Corridor samples escape template |
| `JUNCTION_RESERVATION_VIOLATION` | Root/junction reservation escapes template |
| `TERRITORY_NEGOTIATION_FAILED` | Iteration budget ended without acceptance |
| `TERRITORY_NON_DETERMINISTIC` | Replay differs |
| `NON_SERIALIZABLE_RESULT` | Runtime collections or cyclic/non-JSON state found |

Allocation diagnostics are ordered records: `POWER_DIAGRAM_ALLOCATED`,
`CORRIDORS_PLANNED`, `NEGOTIATION_CONVERGED` or `NEGOTIATION_FAILED`, and
`TERRITORY_PLAN_ACCEPTED` or `TERRITORY_PLAN_REJECTED`. Numeric metrics and
explicit rejection reasons accompany them.
