# Milestone 7.1 — Traceability Matrix

| ID | Requirement | Source | Implementation | Test(s) | Status |
|---|---|---|---|---|---|
| M7.1-1 | TextMeasurementService interface | LCS-CON-005 | `src/core/labels/types.ts` — `TextMeasurementService` | TextMeasurementService.test.ts | ✅ |
| M7.1-2 | TextMeasureRequest type | LCS-LBL-001 | `types.ts` — `TextMeasureRequest` | TextMeasurementService.test.ts | ✅ |
| M7.1-3 | TextMetricsResult type | LCS-LBL-001 | `types.ts` — `TextMetricsResult`, `LineBox` | TextMeasurementService.test.ts | ✅ |
| M7.1-4 | LabelCandidate type | LCS-LBL-002 | `types.ts` — `LabelCandidate`, `LabelCandidateFamily` | — | ✅ |
| M7.1-5 | LabelPlacement type | LCS-CON-005 | `types.ts` — `LabelPlacement` | — | ✅ |
| M7.1-6 | LabelLayoutInput type | LCS-CON-005 | `types.ts` — `LabelLayoutInput` | — | ✅ |
| M7.1-7 | LabelLayoutResult type | LCS-CON-005 | `types.ts` — `LabelLayoutResult` | — | ✅ |
| M7.1-8 | LabelLayoutMetrics type | LCS-CON-005 | `types.ts` — `LabelLayoutMetrics` | — | ✅ |
| M7.1-9 | Unresolved label reasons | LCS-LBL-003 | `types.ts` — `UnresolvedLabelReason`, `UnresolvedReasonCode` | — | ✅ |
| M7.1-10 | SolveContext type | LCS-CON-005 | `types.ts` — `SolveContext` | — | ✅ |
| M7.1-11 | Arabic text measurement | LCS-LBL-001 | `TextMeasurer.ts` — `OpentypeTextMeasurer`; `ArabicShaper.ts` — contextual form selection | TextMeasurementService.test.ts, ArabicShaper.test.ts | ✅ |
| M7.1-12 | Arabic shaping (isolated, initial, medial, final) | LCS-LBL-001, LNGP-R2-04 | `ArabicShaper.ts` — `shapeArabic()` maps base code points to U+FE70–U+FEFC presentation forms | ArabicShaper.test.ts (35 tests) | ✅ |
| M7.1-13 | Lam-alef ligature | LCS-LBL-001 | `ArabicShaper.ts` — lam-alef detection maps to U+FEF5–U+FEFC | ArabicShaper.test.ts | ✅ |
| M7.1-14 | RTL direction support | LCS-LBL-001, LNGP-R2-04 | `TextMeasurer.ts` — `direction: "LTR" \| "RTL"` | TextMeasurementService.test.ts | ✅ |
| M7.1-15 | Deterministic measurement | LCS-LBL-001 | `TypographyCache` — cache keyed by full request | TextMeasurementService.test.ts | ✅ |
| M7.1-16 | Font fallback policy | LCS-LBL-001 | `TextMeasurer.ts` — `resolveFont()` | TextMeasurementService.test.ts | ✅ |
| M7.1-17 | Cache keyed by full typography request | LCS-LBL-001 | `cache.ts` — `TypographyCache.buildKey()` | TextMeasurementService.test.ts | ✅ |
| M7.1-18 | No heuristic character-count sizing | LCS-LBL-001 (prohibition) | `TextMeasurer.ts` — uses real shaped glyph advances | TextMeasurementService.test.ts, ArabicShaper.test.ts | ✅ |
| M7.1-19 | Font-derived line height | LCS-LBL-001 | `TextMeasurer.ts` — `(ascender - descender + lineGap) * scale` | TextMeasurementService.test.ts | ✅ |
| M7.1-20 | Diacritic and combining mark support | LNGP-R2-04 | `ArabicShaper.ts` — transparent (T) joining type passes marks through | ArabicShaper.test.ts | ✅ |
| M7.1-21 | Mixed Arabic/Latin text | LNGP-R2-04 | `ArabicShaper.ts` — non-Arabic characters pass through unchanged | ArabicShaper.test.ts, TextMeasurementService.test.ts | ✅ |
| M7.1-22 | Arabic-Indic and Western numerals | LNGP-R2-04 | `ArabicShaper.ts` — digit types U/J pass through unchanged | ArabicShaper.test.ts | ✅ |
| M7.1-17 | Multiline measurement | LCS-LBL-001 | `TextMeasurer.ts` — `wrapText()` | TextMeasurementService.test.ts | ✅ |
| M7.1-18 | Config: minimumFontSize, maximumRotation | LCS-CON-005 | `src/core/config/types.ts` — `LabelConfig` (existing) | — | ✅ |
| M7.1-19 | Label issue codes | LCS-CON-005 | `src/core/contracts/issues.ts` — `LABEL_ISSUE_CODES` | schema-parity.test.ts | ✅ |
| M7.1-20 | Label stages in solve pipeline | LCS-ARC-002 | `src/core/contracts/solve-stage.ts` — `MILESTONE_7_STAGES` | — | ✅ |
| M7.1-21 | Label layout result schema | LCS-TST-005 | `schemas/label-layout-result.schema.json` | schema-parity.test.ts | ✅ |
| M7.1-22 | Input validation | LCS-LBL-001 | `TextMeasurer.ts` — `validateRequest()` | TextMeasurementService.test.ts | ✅ |
| M7.1-23 | Immutable results | LCS-GOV-001 §7 | `TextMeasurer.ts` — `Object.freeze` on lineBoxes | TextMeasurementService.test.ts | ✅ |

## Quality gates

| Gate | Result |
|---|---|
| Type-check (`tsc --noEmit`) | ✅ PASS |
| Lint (`eslint .`) | ✅ PASS |
| All tests (`vitest run`) | ✅ 241 pass, 1 skip |
| Schema parity | ✅ All schemas compile and validate |
| Deterministic measurement | ✅ Byte-identical on repeat |
| No character-count approximation | ✅ Real glyph metrics |

## Test breakdown

| Suite | Tests | Status |
|---|---|---|
| Unit (labels) | 38 | ✅ All pass |
| Pre-existing (all milestones) | 203 | ✅ No regression |
| Schema parity | 10 | ✅ All pass |
| **Total** | **241** | **✅ All pass (1 pre-existing skip)** |
