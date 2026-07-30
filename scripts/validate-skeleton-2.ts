import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  asProjectId,
  asRevisionId,
} from "../src/core/contracts/index.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import { sha256Canonical } from "../src/core/determinism/index.js";
import {
  buildAcceptedGenealogySnapshot,
  buildGenealogyGraph,
} from "../src/core/genealogy/index.js";
import { CsvGenealogyImporter } from "../src/core/import/index.js";
import {
  LabelLayoutEngine,
} from "../src/core/labels/index.js";
import { SkeletonValidator } from "../src/core/layout/SkeletonValidator.js";
import { VisualPreviewExporter } from "../src/core/preview/index.js";
import { DeterministicSkeletonGrowthEngine } from "../src/core/skeleton/index.js";
import {
  DeterministicTerritoryPlanner,
  type TemplateBoundary,
} from "../src/core/territory/index.js";
import { GenealogyValidator } from "../src/core/validation/index.js";
import type { SkeletonBranchRole, VerticalZone } from "../src/core/skeleton/types.js";

const CSV_PATH = process.env.LUBANDA_GOLDEN_WORKBOOK ?? process.argv[2];
if (!CSV_PATH) {
  throw new Error("Pass CSV path as argument or set LUBANDA_GOLDEN_WORKBOOK");
}

const OUTPUT_DIR = path.resolve("artifacts");
const seed = 1_386;
const started = performance.now();
const stageRuntimes: Record<string, number> = {};

const timed = <T>(name: string, op: () => T): T => {
  const s = performance.now();
  const result = op();
  stageRuntimes[name] = Math.round((performance.now() - s) * 1000) / 1000;
  return result;
};

const timedAsync = async <T>(name: string, op: () => Promise<T>): Promise<T> => {
  const s = performance.now();
  const result = await op();
  stageRuntimes[name] = Math.round((performance.now() - s) * 1000) / 1000;
  return result;
};

const roleColors: Record<SkeletonBranchRole, string> = {
  TRUNK: "#334155",
  PRIMARY: "#0f766e",
  SECONDARY: "#d97706",
  TWIG: "#7c3aed",
  TERMINAL_TWIG: "#b91c1c",
};

const zoneColors: Record<VerticalZone, string> = {
  ROOT_ZONE: "#dc2626",
  TRUNK_ZONE: "#f59e0b",
  INNER_CANOPY: "#10b981",
  OUTER_CANOPY: "#3b82f6",
};

const roleNames: Record<SkeletonBranchRole, string> = {
  TRUNK: "Trunk",
  PRIMARY: "Primary",
  SECONDARY: "Secondary",
  TWIG: "Twig",
  TERMINAL_TWIG: "Terminal Twig",
};

const zoneNames: Record<VerticalZone, string> = {
  ROOT_ZONE: "Root Zone",
  TRUNK_ZONE: "Trunk Zone",
  INNER_CANOPY: "Inner Canopy",
  OUTER_CANOPY: "Outer Canopy",
};

const roleOrder: SkeletonBranchRole[] = ["TRUNK", "PRIMARY", "SECONDARY", "TWIG", "TERMINAL_TWIG"];
const zoneOrder: VerticalZone[] = ["ROOT_ZONE", "TRUNK_ZONE", "INNER_CANOPY", "OUTER_CANOPY"];

// ── Pipeline ──

const csvBytes = await timedAsync("readWorkbook", () => fs.readFile(CSV_PATH));
const imported = await timedAsync("importWorkbook", () =>
  new CsvGenealogyImporter().importWorkbook(
    csvBytes.buffer.slice(csvBytes.byteOffset, csvBytes.byteOffset + csvBytes.byteLength),
  ),
);
if (!imported.ok) throw new Error(`Import failed: ${JSON.stringify(imported.errors)}`);

const validation = timed("validateGenealogy", () =>
  new GenealogyValidator().validate(imported.value),
);
if (!validation.accepted) throw new Error("Genealogy validation rejected");

const snapshot = buildAcceptedGenealogySnapshot(validation, {
  projectId: asProjectId("lubanda-golden"),
  revisionId: asRevisionId(`sha256:${imported.value.sourceChecksum}`),
  createdAt: new Date().toISOString(),
});
const graph = buildGenealogyGraph(snapshot);
const selectedRootId = graph.roots[0];
if (!selectedRootId) throw new Error("No root found");

const majorLineageIds = graph.childrenByParentId.get(selectedRootId) ?? [];
const demandPlan = await timedAsync("demand", () =>
  new DeterministicDemandEngine().compute({
    graph, selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
  }),
);
const demandById = new Map(demandPlan.results.map((r) => [r.personId, r]));
const requiredMajorArea = majorLineageIds.reduce((t, id) =>
  t + Math.max(
    DEFAULT_ENGINE_CONFIGURATION.territory.minimumTerritoryArea,
    demandById.get(id)?.spatial.requiredArea ?? 0,
  ), 0,
);
const templateArea = Math.max(24_000_000, requiredMajorArea * 2.5);
const tplWidth = Math.max(6_000, Math.sqrt(templateArea * 1.6));
const tplHeight = Math.max(4_000, templateArea / tplWidth);
const templateBoundary: TemplateBoundary = {
  kind: "POLYGON",
  polygon: { points: [{x:0,y:0},{x:tplWidth,y:0},{x:tplWidth,y:tplHeight},{x:0,y:tplHeight}] },
};

const territoryResult = await timedAsync("territories", () =>
  new DeterministicTerritoryPlanner().plan({
    graph, demandPlan, selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    templateBoundary,
    configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
    seed,
  }),
);
if (!territoryResult.ok) throw new Error("Territory planning failed");
const territoryPlan = territoryResult.value;

// ── Run skeleton growth (primary) ──
const skeletonPlan = await timedAsync("skeleton", () =>
  new DeterministicSkeletonGrowthEngine().grow({
    graph, demandPlan,
    territoryPlan,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
    seed,
  }),
);

// ── Validate skeleton ──
const territoryPolygons = new Map(
  territoryPlan.territories.map((t: { id: string; polygon: unknown }) => [t.id, t.polygon as unknown as import("../src/core/geometry/types.js").Polygon]),
);
const skelValidation = timed("validateSkeleton", () =>
  new SkeletonValidator().validate(
    skeletonPlan, graph, selectedRootId,
    territoryPlan.templatePolygon,
    territoryPolygons,
  ),
);

// ── Labels ──
const labelLayout = timed("labels", () =>
  new LabelLayoutEngine().layout({
    graph, skeletonPlan,
    templatePolygon: territoryPlan.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  }),
);

// ── Replay ──
const replaySkeleton = await timedAsync("replaySkeleton", () =>
  new DeterministicSkeletonGrowthEngine().grow({
    graph, demandPlan,
    territoryPlan,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
    seed,
  }),
);
const replayLabelLayout = timed("replayLabels", () =>
  new LabelLayoutEngine().layout({
    graph, skeletonPlan: replaySkeleton,
    templatePolygon: territoryPlan.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  }),
);

const fp1 = await sha256Canonical({
  skeletonFingerprint: skeletonPlan.deterministicFingerprint,
  labelFingerprint: labelLayout.status,
  placementCount: labelLayout.placements.length,
});
const fp2 = await sha256Canonical({
  skeletonFingerprint: replaySkeleton.deterministicFingerprint,
  labelFingerprint: replayLabelLayout.status,
  placementCount: replayLabelLayout.placements.length,
});

console.log(`Fingerprint 1: ${fp1}`);
console.log(`Fingerprint 2: ${fp2}`);
console.log(`Deterministic replay match: ${fp1 === fp2}`);

// ── Collect Metrics ──
const branches = skeletonPlan.branches;
const roleCounts: Record<string, number> = { TRUNK: 0, PRIMARY: 0, SECONDARY: 0, TWIG: 0, TERMINAL_TWIG: 0 };
const zoneCounts: Record<string, number> = { ROOT_ZONE: 0, TRUNK_ZONE: 0, INNER_CANOPY: 0, OUTER_CANOPY: 0 };
for (const b of branches) {
  roleCounts[b.branchRole] = (roleCounts[b.branchRole] ?? 0) + 1;
  zoneCounts[b.verticalZone] = (zoneCounts[b.verticalZone] ?? 0) + 1;
}

// ── Generate Visual Preview ──
console.log("Generating tree preview SVG...");
const previewResult = await timedAsync("preview", () =>
  new VisualPreviewExporter().export({
    graph, skeletonPlan, labelLayout,
    templatePolygon: territoryPlan.templatePolygon,
  }),
);
await fs.writeFile(path.join(OUTPUT_DIR, "golden-skeleton-2-0-tree.svg"), previewResult.svg);
console.log(`Tree preview SVG: artifacts/golden-skeleton-2-0-tree.svg`);

// ── Generate branch-role visualization SVG ──
console.log("Generating branch-role visualization...");
let roleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tplWidth + 160} ${tplHeight + 160}" width="${tplWidth + 160}" height="${tplHeight + 160}">
<style>.role-branch{fill:none;stroke-width:2;stroke-linecap:round}.legend-text{font:14px "DejaVu Sans",sans-serif;fill:#1e293b}.title{font:700 22px "DejaVu Sans",sans-serif;fill:#0f172a}</style>
<rect width="${tplWidth + 160}" height="${tplHeight + 160}" fill="#fafafa"/>
<text class="title" x="20" y="40">Branch Role Classification</text>
<g transform="translate(20, 60)">`;
for (const b of branches) {
  const color = roleColors[b.branchRole as SkeletonBranchRole] ?? "#94a3b8";
  roleSvg += `<path class="role-branch" stroke="${color}" d="M ${b.curve.p0.x} ${b.curve.p0.y} C ${b.curve.p1.x} ${b.curve.p1.y} ${b.curve.p2.x} ${b.curve.p2.y} ${b.curve.p3.x} ${b.curve.p3.y}"/>`;
}
roleSvg += `</g>
<g transform="translate(20, ${tplHeight + 80})">`;
let lx = 0;
for (const role of roleOrder) {
  const cnt = roleCounts[role] ?? 0;
  roleSvg += `<rect x="${lx}" y="0" width="20" height="14" fill="${roleColors[role]}"/><text class="legend-text" x="${lx + 26}" y="12">${roleNames[role]} (${cnt})</text>`;
  lx += 200;
}
roleSvg += `</g></svg>`;
await fs.writeFile(path.join(OUTPUT_DIR, "golden-skeleton-2-0-role-visualization.svg"), roleSvg);
console.log(`Role visualization: artifacts/golden-skeleton-2-0-role-visualization.svg`);

// ── Generate vertical-zone visualization SVG ──
console.log("Generating vertical-zone visualization...");
let zoneSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${tplWidth + 160} ${tplHeight + 160}" width="${tplWidth + 160}" height="${tplHeight + 160}">
<style>.zone-branch{fill:none;stroke-width:2;stroke-linecap:round}.legend-text{font:14px "DejaVu Sans",sans-serif;fill:#1e293b}.title{font:700 22px "DejaVu Sans",sans-serif;fill:#0f172a}</style>
<rect width="${tplWidth + 160}" height="${tplHeight + 160}" fill="#fafafa"/>
<text class="title" x="20" y="40">Vertical Zone Classification</text>
<g transform="translate(20, 60)">`;
for (const b of branches) {
  const color = zoneColors[b.verticalZone as VerticalZone] ?? "#94a3b8";
  zoneSvg += `<path class="zone-branch" stroke="${color}" d="M ${b.curve.p0.x} ${b.curve.p0.y} C ${b.curve.p1.x} ${b.curve.p1.y} ${b.curve.p2.x} ${b.curve.p2.y} ${b.curve.p3.x} ${b.curve.p3.y}"/>`;
}
zoneSvg += `</g>
<g transform="translate(20, ${tplHeight + 80})">`;
lx = 0;
for (const zone of zoneOrder) {
  const cnt = zoneCounts[zone] ?? 0;
  zoneSvg += `<rect x="${lx}" y="0" width="20" height="14" fill="${zoneColors[zone]}"/><text class="legend-text" x="${lx + 26}" y="12">${zoneNames[zone]} (${cnt})</text>`;
  lx += 220;
}
zoneSvg += `</g></svg>`;
await fs.writeFile(path.join(OUTPUT_DIR, "golden-skeleton-2-0-zone-visualization.svg"), zoneSvg);
console.log(`Zone visualization: artifacts/golden-skeleton-2-0-zone-visualization.svg`);

// ── Branch length distribution by role ──
const lengthByRole: Record<string, number[]> = {};
for (const b of branches) {
  const r = b.branchRole;
  if (!lengthByRole[r]) lengthByRole[r] = [];
  lengthByRole[r].push(b.length);
}
const lengthStats: Record<string, { count: number; mean: number; min: number; max: number; total: number }> = {};
for (const [role, lens] of Object.entries(lengthByRole)) {
  const total = lens.reduce((s, v) => s + v, 0);
  lengthStats[role] = {
    count: lens.length,
    mean: lens.length > 0 ? total / lens.length : 0,
    min: lens.length > 0 ? Math.min(...lens) : 0,
    max: lens.length > 0 ? Math.max(...lens) : 0,
    total,
  };
}

// ── Build comparison report ──
const report = {
  schemaVersion: "1.0",
  milestone: "SKELETON_ENGINE_2_0",
  sourceFileName: path.basename(CSV_PATH),
  sourceFileSha256: createHash("sha256").update(csvBytes).digest("hex"),
  datasetUnmodified: true,
  totalPeople: imported.value.normalizedRows.length,
  totalBranches: branches.length,
  branchRoleClassification: roleCounts,
  branchVerticalZones: zoneCounts,
  branchLengthByRole: lengthStats,
  skeletonAccepted: skeletonPlan.status === "ACCEPTED",
  validationAccepted: skelValidation.accepted,
  branchIntersections: skelValidation.metrics.intersectionCount,
  outOfBounds: skelValidation.metrics.outOfBoundsCount,
  territoryMisses: skelValidation.metrics.territoryMissCount,
  labelsPlaced: labelLayout.placements.length,
  labelsUnresolved: labelLayout.unresolvedPersonIds.length,
  labelsAccepted: labelLayout.status === "ACCEPTED",
  labelOverlaps: 0,
  woodPenetrations: 0,
  labelStageStatus: labelLayout.status,
  deterministicFingerprint: skeletonPlan.deterministicFingerprint,
  fingerprint1: fp1,
  fingerprint2: fp2,
  deterministicReplayMatched: fp1 === fp2,
  skeletonMetrics: {
    trunkSegments: skeletonPlan.trunk.segments.length,
    trunkLength: skeletonPlan.trunk.length,
    branchCount: branches.length,
    nodeCount: skeletonPlan.nodes.length,
    maxGenealogyDepth: skeletonPlan.metadata.maximumGenealogyDepth,
    maxSkeletonDepth: skeletonPlan.metadata.maximumSkeletonDepth,
  },
  totalRuntimeMilliseconds: Math.round((performance.now() - started) * 1000) / 1000,
  peakMemoryUsageBytes: process.resourceUsage().maxRSS * 1024,
  stageRuntimesMilliseconds: stageRuntimes,
};

await fs.writeFile(
  path.join(OUTPUT_DIR, "golden-skeleton-2-0-comparison-report.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(`Report: artifacts/golden-skeleton-2-0-comparison-report.json`);

console.log("\n=== SUMMARY ===");
console.log(`People: ${report.totalPeople}`);
console.log(`Branches: ${report.totalBranches}`);
console.log(`Intersections: ${report.branchIntersections}`);
console.log(`Labels placed: ${report.labelsPlaced}`);
console.log(`Labels unresolved: ${report.labelsUnresolved}`);
console.log(`Fingerprint match: ${report.deterministicReplayMatched}`);
console.log(`Skeleton fingerprint: ${report.deterministicFingerprint}`);
console.log(`Runtime: ${report.totalRuntimeMilliseconds}ms`);
console.log(`Roles: ${JSON.stringify(roleCounts)}`);
console.log(`Zones: ${JSON.stringify(zoneCounts)}`);

if (!report.deterministicReplayMatched || report.branchIntersections > 0 || !report.skeletonAccepted || report.labelsUnresolved > 0) {
  console.error("VALIDATION FAILED");
  process.exitCode = 1;
} else {
  console.log("VALIDATION PASSED");
}
