# Milestone 2 known limitations and risks

- v1 territory operations require a convex usable template. Concave templates
  must be decomposed by a future reviewed contract; they are rejected today.
- Major territories are owned by direct children of the selected render root.
  Nested sub-territories are intentionally deferred.
- Corridors reserve width and connectivity but do not prove collision-free final
  branch routing; that is the approval-gated Milestone 3 responsibility.
- Corridor containment validates its deterministic polyline and contained
  junction reservation. A full swept-width polygon test is deferred to routing.
- Label footprints are estimates only. Actual label placement is not present.
- Floating-point determinism is defined for the supported JavaScript runtime and
  canonical rounding boundary; cross-language implementations must reproduce
  these rules explicitly.
- Reported memory is an RSS high-water approximation at benchmark boundaries,
  not allocation-profiler instrumentation.
- The official workbook has only two major lineages under root `1`; synthetic
  star/property fixtures cover many-lineage behavior.
