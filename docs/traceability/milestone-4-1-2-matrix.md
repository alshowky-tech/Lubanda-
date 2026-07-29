# Milestone 4.1.2 traceability matrix

| ID | Requirement | Implementation | Verification |
|---|---|---|---|
| M4.1.2-01 | Derive anchors from accepted skeleton geometry | `LabelCandidateGenerator.ts` | skeleton-to-label integration replay |
| M4.1.2-02 | Generate multiple stable candidates per person | 3 Bézier sites × 8 directions; stable candidate IDs | unique-ID and 24-per-person assertions |
| M4.1.2-03 | Avoid duplicate root/trunk labels | deterministic terminal branch selection | unique-person metric assertion |
| M4.1.2-04 | Enforce convex and concave template boundaries | `boundsInsidePolygon` | 3 focused boundary tests |
| M4.1.2-05 | Prevent label/wood overlap | densified tapered wood obstacles + `LabelCollisionQuery` | accepted integration fixture; collision rejections |
| M4.1.2-06 | Prevent label/label overlap | `LabelAssignmentEngine` | integration collision-query replay |
| M4.1.2-07 | Report unresolved labels | `LABEL_UNRESOLVED` diagnostics and `PARTIAL` status | excluded-boundary integration fixture |
| M4.1.2-08 | Deterministic replay | canonical branch/person/candidate ordering | identical repeated result assertion |
| M4.1.2-09 | Preserve public API | label barrel + root package barrel | strict type-check |
| M4.1.2-10 | No regression | existing test suites | full Vitest, type-check, and lint gates |
