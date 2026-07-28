# Milestone 1 File Plan

This revision incorporates the fifteen approved Lubanda Core v1 clarifications. The
planned boundary is intentionally limited to contracts, configuration, acquisition,
normalization, validation, accepted snapshots, runtime genealogy indexing, geometry,
the spatial index, tests, and diagnostic evidence.

| Area | Files |
|---|---|
| Project gates | `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore` |
| Public entry point | `src/index.ts` |
| Contracts | `src/core/contracts/{diagnostics,identifiers,index,issues,solve-stage,stage-result}.ts` |
| Configuration | `src/core/config/{defaults,index,types,validate-configuration}.ts`, `configs/default-engine-configuration.json` |
| JSON Schemas | `schemas/{engine-configuration,error-codes,genealogy-snapshot,person}.schema.json` |
| Import | `src/core/import/{WorkbookImporter,detect-header,header-aliases,index,types,workbook-limits,xlsx-reader,zip-preflight}.ts` |
| Genealogy core | `src/core/genealogy/{canonical-order,checksum,graph,index,normalize,numerals,scope,snapshot,types}.ts` |
| Validation | `src/core/validation/{cycle-detection,index,issue-codes,policy,validator}.ts` |
| Geometry | `src/core/geometry/{bezier,bounds,finite,index,numeric-policy,polygon,segments,types,vec2}.ts` |
| Spatial index | `src/core/spatial/{SpatialHash,index,types}.ts` |
| Automated tests | `tests/unit/**`, `tests/property/**`, `tests/integration/**`, `tests/helpers/**`, `tests/fixtures/**` |
| Documentation | `README.md`, `docs/architecture/**`, `docs/decisions/**`, `docs/traceability/**`, this file |
| Evidence scripts | `scripts/generate-diagnostic-svg.ts`, `scripts/validate-official-workbook.ts` |
| Generated evidence | `artifacts/milestone-1-geometry-diagnostics.svg`, `artifacts/official-workbook-validation.json`, completion report and file manifest |

Explicitly excluded are UI, bark, leaves, template rendering, AI rendering,
territory allocation, demand computation, skeleton growth, collision resolution,
label placement, layout validation, skeleton freezing, and export.
