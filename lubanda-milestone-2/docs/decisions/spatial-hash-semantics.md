# SpatialHash Semantics — Core v1

- IDs are stable non-empty strings.
- Inserting an existing ID throws `SPATIAL_DUPLICATE_ID`.
- Updating a missing ID throws `SPATIAL_MISSING_ID`.
- Removing a missing ID is idempotent and returns `false`.
- Each entry is stored in every grid cell touched by its closed bounds.
- Query results are deduplicated by ID even when an entry occupies many cells.
- Query results include only entries whose bounds overlap the query bounds.
- Query results are sorted lexicographically by ID, independent of insertion
  order and cell traversal order.
- Cell size must be positive and finite.
- Bounds and query coordinates must be finite and normalized.
- The index uses internal geometry units and has no dependency on pixels.

