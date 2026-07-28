# ADR 0002: additive Milestone 2 contract extension

Status: accepted for Milestone 2.

Milestone 1 public contracts remain source-compatible. The change adds demand
fields, territory configuration, branded identifiers, pipeline stages, issue
codes, DTO schemas, and public demand/territory exports. Existing skeleton,
collision, label, stability, and performance configuration sections remain
unchanged for compatibility; no corresponding later-milestone engine is
implemented here.

Runtime `Map` indexes are explicitly separated from DTOs. A territory plan is
only produced from a selected render root and an already accepted snapshot.
Preliminary `GrowthCorridor.centerline` means reservation connectivity, not a
final routed branch; this naming is retained to match the Core specification.

The power-diagram fallback is a deterministic oblique area-transfer partition.
It exists to enforce connectedness, minimum area, and termination when weighted
power negotiation becomes numerically inefficient. The fallback does not
change canonical lineage ownership or genealogy.
