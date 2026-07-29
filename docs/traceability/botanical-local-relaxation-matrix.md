# Botanical local relaxation traceability

| Requirement | Implementation | Evidence |
|---|---|---|
| Preserve genealogy and topology | Control-point-only proposals | endpoint and source immutability assertions |
| Deterministic bounded movement | Fixed branch order, decaying steps, deterministic rounding | replay and reordered-input assertions |
| Territory attraction | Mean territory-distance objective | before/after score assertions |
| Preserve hard geometry constraints | `SkeletonValidator` on every proposal | final independent validation assertion |
| Preserve label constraints | `LabelLayoutEngine` on every valid proposal | accepted label-layout assertion |
| Preserve exact labels | Fixed placements plus per-branch wood-clearance filtering | Golden report `labelsUnchanged` |
| Atomic rejection | Candidate plan replaces current plan only after all gates pass | implementation and iteration records |
| Immutable derived revision | `freezeSkeletonPlan` and canonical SHA-256 | fingerprint assertions |
| Visual improvement | Golden BEFORE/AFTER previews and moved-branch overlay | Golden comparison report |
