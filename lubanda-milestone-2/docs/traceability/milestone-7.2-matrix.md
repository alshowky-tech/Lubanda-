# Milestone 7.2 — Traceability Matrix

| ID | Requirement | Source | Implementation | Test(s) | Status |
|---|---|---|---|---|---|
| M7.2-1 | Candidate families (ALIGNED, ABOVE, BELOW, LATERAL, TERMINAL LEAF, CARTOUCHE) | LCS-LBL-002 | `LabelCandidateGenerator.ts` | LabelCandidateGenerator.test.ts | ✅ |
| M7.2-2 | Terminal-leaf generation via GenealogyGraph.isTerminal() | LCS-LBL-002 | `LabelCandidateGenerator.ts` | LabelCandidateGenerator.test.ts | ✅ |
| M7.2-3 | Cartouche zones generated only when zone geometry supplied | LCS-LBL-002 | `LabelCandidateGenerator.ts` | LabelCandidateGenerator.test.ts | ✅ |
| M7.2-4 | TextMeasurementService used for label bounds | LCS-LBL-001, LCS-LBL-002 | `LabelCandidateGenerator.ts` — `measure()` | LabelCandidateGenerator.test.ts | ✅ |
| M7.2-5 | Branch tangent→rotation computation | LNGP-R3-06 §4 | `LabelCandidateGenerator.ts` — `cubicBezierTangent()` | LabelCandidateGenerator.test.ts | ✅ |
| M7.2-6 | CandidateCollisionQuery read-only abstraction | D10 | `CandidateCollisionQuery.ts` | LabelCandidateGenerator.test.ts | ✅ |
| M7.2-7 | Self-anchor exemption radius = max(baseThickness, 8) | D5 | `LabelCandidateValidator.ts` | LabelCandidateValidator.test.ts | ✅ |
| M7.2-8 | VALID/INVALID status with score=null for invalid | D7 | `LabelCandidateScorer.ts` | LabelCandidateScorer.test.ts | ✅ |
| M7.2-9 | Structured rejection reasons for diagnostics | D7 | `LabelCandidateScorer.ts`, `LabelCandidateValidator.ts` | LabelCandidateValidator.test.ts | ✅ |
| M7.2-10 | Scoring weights configurable (0.35/0.25/0.15/0.10/0.15) | D1 | `LabelCandidateScorer.ts` — `ScoringWeights`, `DEFAULT_SCORING_WEIGHTS` | LabelCandidateScorer.test.ts | ✅ |
| M7.2-11 | Deterministic tie-breaking (person ID, family priority) | LCS-TST-005 Gate 6 | `LabelCandidateScorer.ts` — sort order | LabelCandidateScorer.test.ts | ✅ |
| M7.2-12 | Component scores exposed for diagnostics | LCS-LBL-002 | `LabelCandidateScorer.ts` — `componentScores` | LabelCandidateScorer.test.ts | ✅ |
| M7.2-13 | Rotation clamped to maximumRotationDegrees | LCS-LBL-002 | `LabelCandidateGenerator.ts` — `clampedAngle` | LabelCandidateGenerator.test.ts | ✅ |
| M7.2-14 | Fixed obstacle validation (branch envelope, boundary, leader crossing) | LCS-LBL-003, LCS-GOV-002 | `LabelCandidateValidator.ts` | LabelCandidateValidator.test.ts | ✅ |
| M7.2-15 | No candidate-to-candidate solving (deferred to M7.3) | LCS-LBL-003 | Not implemented | — | ✅ |
| M7.2-16 | Prior-location scoring deferred to M8 | D8 | Not implemented | — | ✅ |
| M7.2-17 | All existing M7.1 tests pass | LCS-GOV-001 | Regression | Full suite | ✅ |
| M7.2-18 | All existing M4.2 (Collision Safety) tests pass | LCS-GOV-001 | Regression | Full suite | ✅ |

## Quality gates

| Gate | Result |
|---|---|
| Type-check (`tsc --noEmit`) | ✅ PASS |
| Lint (`eslint .`) | ✅ PASS |
| All tests (`vitest run`) | ✅ 336 pass, 1 skip |
| Schema parity | ✅ All schemas compile and validate |
| Collision Safety regression | ✅ 55/55 pass |
