# Lubanda Core Milestone 1 Completion Report

Date: 2026-07-27  
Status: Complete; awaiting approval before Milestone 2

## Implemented Scope

Contracts → Configuration → Import → Normalization → Validation → Genealogy
Graph → Geometry Foundation → SpatialHash → Automated Tests

No UI, visual growth, territory allocation, skeleton growth, collision
resolution, labels, bark, leaves, templates, AI rendering, or export modules
were created.

## Verification Results

| Gate | Result |
|---|---|
| Type-check | PASS — `tsc --noEmit` |
| Lint | PASS — ESLint, zero findings |
| Unit tests | PASS — 16 files, 57 tests |
| Property tests | PASS — 3 files, 5 tests |
| Integration tests | PASS — 3 files, 5 tests, including the official workbook and diagnostic SVG |
| Schema parity | PASS — 1 file, 5 tests, including typed/JSON default identity |
| Dependency audit | PASS — zero vulnerabilities, production and full dependency trees |
| Diagnostic SVG | PASS — regenerated from the implemented geometry and SpatialHash APIs |

## Official Workbook Evidence

| Measure | Result |
|---|---:|
| Worksheet | `السلسلة الشوكية الهاشمية` |
| Normalized rows | 1,386 |
| Accepted people | 1,386 |
| Roots | 1 |
| Maximum generation | 13 |
| Blocking issues | 0 |
| Source checksum | `30fb1f4d977ae882b631b727afe50ef2de6ae4c9c8092bd4d7203670cdd35da9` |

The source workbook was read for validation and was not copied into the package.
No genealogy was altered for visual purposes.

## Contract Decisions Applied

All fifteen approved clarifications are recorded in
`docs/decisions/0001-milestone-1-contract-clarifications.md`. In particular,
snapshot construction accepts the discriminated validation report and throws
unless it is accepted and contains no blocking issue. Snapshot DTOs are plain
serializable objects; runtime graph maps stay internal.

## Known Limitations

- Import supports OOXML `.xlsx`, not legacy binary `.xls`. Formulas are not
  evaluated: cached values are used, formulas without cached values are blocking,
  and macros/external links are rejected.
- Header recognition is contract-driven through the current Arabic/English alias
  catalog. A new source template may require an explicit alias revision.
- The source audit payload retains mapped source values, not arbitrary unmapped
  workbook columns or workbook formatting.
- `GenealogyRevisionCommitter` is a typed persistence port only; no database,
  filesystem revision repository, or automatic commit exists in this milestone.
- A render root can be selected and scoped, but no layout is performed.
- SpatialHash assumes operationally bounded geometry. A future caller should not
  submit bounds spanning an impractically large number of cells.
- Bézier bounds and lengths are tolerance-bounded approximations, as documented;
  they are not analytic extrema or exact arc length.
- Primary visual reference images were not required or used in Milestone 1.
- The `INDEX.md` Bible-manifest discrepancy is recorded for the next
  documentation revision and the supplied governing archive was not modified.

## Evidence Index

- `docs/milestone-1-file-plan.md`
- `docs/architecture/milestone-1-architecture.md`
- `docs/traceability/milestone-1-matrix.md`
- `artifacts/official-workbook-validation.json`
- `artifacts/milestone-1-geometry-diagnostics.svg`
- `artifacts/milestone-1-file-manifest.json`
