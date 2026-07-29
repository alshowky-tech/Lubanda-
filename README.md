# Lubanda Core — Milestone 3

This repository preserves Milestones 1 and 2 and implements the third approved
engineering milestone of the Lubanda Natural Genealogy Growth Platform:

`Territory Plan → Trunk Centerline → Junction Planning → Recursive Skeleton Growth → Candidate Generation → Hard Rejection → Deterministic Scoring → Skeleton Validation → Diagnostics → Automated Tests → Documentation`

It intentionally contains no routing, collision solving, label engine, artistic
renderer, AI adapter, or export engine.

## Pipeline

```
Accepted Territory Plan
    ↓
Trunk Centerline (root entry → junctions → canopy)
    ↓
Junction Mapping (territory junctions → trunk nodes)
    ↓
Recursive Skeleton Growth (per person in genealogy subtree)
    ↓
Branch Candidate Generation (seeded cubic Bezier curves)
    ↓
Hard Candidate Rejection (length, curvature, bounds, intersection)
    ↓
Deterministic Candidate Scoring (smoothness, naturalness, direction, length, attractor)
    ↓
Best Candidate Selection
    ↓
Skeleton Validation (structural checks)
    ↓
Frozen Skeleton Plan (deep-frozen DTO + SHA-256 fingerprint)
```

## Commands

```bash
npm run typecheck
npm run lint
npm run test
npm run test:unit
npm run test:property
npm run test:integration
npm run test:schema
npm run diagnostic:svg
npm run diagnostic:territory-svg
npm run diagnostic:skeleton-svg
npm run validate:official
npm run benchmark:official
```

## Governing documents

- The Lubanda Bible — Official First Edition
- Lubanda Core Specification v1.0
- Approved Core v1 contract clarifications dated 2026-07-27
- ADR 0003 — Milestone 3 Skeleton Growth Contract

## Corrective label-assignment layer

This corrective package adds deterministic label candidate identity, collision queries, and greedy assignment. Rendering, export, AI bark generation, and incremental stability remain out of scope.
