# Geometry Predicate Semantics — Core v1

- All public geometry functions reject non-finite numbers.
- `epsilon` is an absolute internal-unit tolerance and must be positive and
  finite. The default is `1e-9`.
- Segment endpoints are part of a segment.
- A unique intersection strictly inside both segments is `PROPER`.
- A unique shared endpoint or endpoint-on-interior contact is `ENDPOINT_TOUCH`.
- Collinear contact at one point is `COLLINEAR_TOUCH`.
- Collinear contact over a positive-length interval is `COLLINEAR_OVERLAP`.
- Parallel disjoint segments and collinear disjoint segments are `NONE`.
- A zero-length segment is degenerate. Two coincident degenerate segments, or a
  degenerate point lying on another segment, are `DEGENERATE_TOUCH`; otherwise
  the result is `NONE`.
- Bounds are closed for containment and overlap predicates.
- Polygon boundary points are reported separately from inside and outside.
- Cubic Bézier sampling uses recursive de Casteljau subdivision until both
  control points are within the configured flatness tolerance of the chord, or
  `maxSubdivisionDepth` is reached.
- Bézier tolerance must be positive and finite. Hitting the maximum depth
  returns the bounded approximation; it never changes the curve.

