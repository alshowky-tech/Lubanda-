import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Resvg } from "@resvg/resvg-js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import { asProjectId, asRevisionId } from "../src/core/contracts/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import { canonicalJson, sha256Canonical } from "../src/core/determinism/index.js";
import {
  buildAcceptedGenealogySnapshot,
  buildGenealogyGraph,
} from "../src/core/genealogy/index.js";
import {
  BotanicalGrowthIntelligenceEngine,
  type BotanicalDensityCell,
  type BotanicalGrowthVector,
} from "../src/core/growth-intelligence/index.js";
import { BotanicalLocalRelaxationEngine } from "../src/core/growth/index.js";
import { sampleCubicBezier } from "../src/core/geometry/bezier.js";
import { boundsFromPoints } from "../src/core/geometry/bounds.js";
import type { CubicBezier, Vec2 } from "../src/core/geometry/types.js";
import { XlsxGenealogyImporter } from "../src/core/import/index.js";
import {
  buildSkeletonWoodObstacles,
  LabelCollisionQuery,
  LabelLayoutEngine,
  type LabelLayoutResult,
} from "../src/core/labels/index.js";
import { SkeletonValidator } from "../src/core/layout/index.js";
import { VisualPreviewExporter } from "../src/core/preview/index.js";
import {
  DeterministicSkeletonGrowthEngine,
  type SkeletonBranch,
  type SkeletonPlan,
} from "../src/core/skeleton/index.js";
import { BotanicalTerritoryGrowthEngine } from "../src/core/territory-growth/index.js";
import {
  DeterministicTerritoryPlanner,
  type TemplateBoundary,
  type Territory,
} from "../src/core/territory/index.js";
import { GenealogyValidator } from "../src/core/validation/index.js";

const workbookPath =
  process.env.LUBANDA_GOLDEN_WORKBOOK ??
  process.env.LUBANDA_OFFICIAL_WORKBOOK ??
  process.argv[2];
if (!workbookPath) {
  throw new Error("Set LUBANDA_GOLDEN_WORKBOOK or pass the Golden Dataset .xlsx path");
}
const outputDirectory = path.resolve(
  process.env.LUBANDA_BGI_OUTPUT_DIR ?? "artifacts",
);
const artifact = (suffix: string): string =>
  path.join(outputDirectory, `golden-botanical-growth-intelligence-${suffix}`);
const currentSvgPath = artifact("current-arbor-ivy.svg");
const currentPngPath = artifact("current-arbor-ivy.png");
const resultSvgPath = artifact("bgi-result.svg");
const resultPngPath = artifact("bgi-result.png");
const overlayPath = artifact("difference-overlay.svg");
const overlayPngPath = artifact("difference-overlay.png");
const vectorsPath = artifact("growth-vectors.svg");
const vectorsPngPath = artifact("growth-vectors.png");
const heatmapPath = artifact("density-heatmap.svg");
const heatmapPngPath = artifact("density-heatmap.png");
const reportPath = artifact("comparison-report.json");
const seed = 1_386;
const started = performance.now();
const stages: Record<string, number> = {};
const PNG_WIDTH = 4_096;
const DECIMALS = 6;

const round = (value: number): number =>
  Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;
const format = (value: number): string =>
  round(value).toFixed(DECIMALS).replace(/0+$/, "").replace(/\.$/, "");
const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  const stageStarted = performance.now();
  try {
    return await operation();
  } finally {
    stages[name] = round(performance.now() - stageStarted);
  }
};
const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const rasterize = (svg: string): Uint8Array =>
  new Resvg(svg, {
    background: "#ffffff",
    fitTo: { mode: "width", value: PNG_WIDTH },
    font: { defaultFontFamily: "DejaVu Sans", loadSystemFonts: true },
  }).render().asPng();
const createTemplate = (requiredArea: number): TemplateBoundary => {
  const area = Math.max(144_000_000, requiredArea * 6);
  const width = Math.max(6_000, Math.sqrt(area * 1.6));
  const height = Math.max(4_000, area / width);
  return {
    kind: "POLYGON",
    polygon: { points: [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
    ] },
  };
};
const botanicalStyle = (svg: string, title: string): string =>
  svg
    .replace("Lubanda Golden Dataset — Visual Validation Preview", title)
    .replace(
      ".branch-recovery{stroke:#d97706;stroke-dasharray:9 6;opacity:.82}",
      ".branch-recovery{stroke:#246b45;opacity:.88}",
    );
const branchPath = (branch: SkeletonBranch): string =>
  `M ${format(branch.curve.p0.x)} ${format(branch.curve.p0.y)} ` +
  `C ${format(branch.curve.p1.x)} ${format(branch.curve.p1.y)} ` +
  `${format(branch.curve.p2.x)} ${format(branch.curve.p2.y)} ` +
  `${format(branch.curve.p3.x)} ${format(branch.curve.p3.y)}`;
const injectBeforeSkeleton = (svg: string, content: string): string =>
  svg.replace("<g id=\"skeleton\">", `${content}\n<g id="skeleton">`);
const differenceOverlay = (
  current: SkeletonPlan,
  result: SkeletonPlan,
  baseSvg: string,
): string => {
  const currentById = new Map(current.branches.map((branch) => [branch.id, branch]));
  const paths = result.branches.flatMap((branch) => {
    const before = currentById.get(branch.id);
    if (!before || canonicalJson(before.curve) === canonicalJson(branch.curve)) {
      return [];
    }
    const width = Math.max(
      1.25,
      (branch.thickness.baseThickness + branch.thickness.tipThickness) / 2,
    );
    return [
      `<g data-bgi-branch="${branch.id}">` +
      `<path d="${branchPath(before)}" fill="none" stroke="#f97316" ` +
      `stroke-width="${format(width + 1)}" stroke-dasharray="10 7" opacity=".5"/>` +
      `<path d="${branchPath(branch)}" fill="none" stroke="#15803d" ` +
      `stroke-width="${format(width + 1)}" opacity=".82"/></g>`,
    ];
  }).join("\n");
  return injectBeforeSkeleton(
    botanicalStyle(baseSvg, "Lubanda Golden Dataset — BGI Difference Overlay"),
    `<g id="bgi-difference-overlay">${paths}</g>`,
  ).replace("<g id=\"skeleton\">", "<g id=\"skeleton\" opacity=\".22\">");
};
const growthVectorSvg = (
  vectors: readonly BotanicalGrowthVector[],
  baseSvg: string,
): string => {
  const lines = vectors.map((vector) => {
    const length = Math.min(90, 24 + vector.localDensity * 0.35);
    const end = {
      x: vector.origin.x + vector.vector.x * length,
      y: vector.origin.y + vector.vector.y * length,
    };
    return `<line x1="${format(vector.origin.x)}" y1="${format(vector.origin.y)}" ` +
      `x2="${format(end.x)}" y2="${format(end.y)}" stroke="#2563eb" ` +
      `stroke-width="2" opacity=".58" marker-end="url(#bgi-arrow)"/>`;
  }).join("\n");
  const definitions =
    `<defs><marker id="bgi-arrow" viewBox="0 0 10 10" refX="8" refY="5" ` +
    `markerWidth="5" markerHeight="5" orient="auto-start-reverse">` +
    `<path d="M 0 0 L 10 5 L 0 10 z" fill="#2563eb"/></marker></defs>`;
  return injectBeforeSkeleton(
    botanicalStyle(baseSvg, "Lubanda Golden Dataset — BGI Growth Vectors"),
    `${definitions}<g id="bgi-growth-vectors">${lines}</g>`,
  ).replace("<g id=\"skeleton\">", "<g id=\"skeleton\" opacity=\".32\">");
};
const densityHeatmapSvg = (
  cells: readonly BotanicalDensityCell[],
  baseSvg: string,
): string => {
  const maximum = Math.max(
    1,
    ...cells.map((cell) => cell.branchDensity + cell.labelDensity * 4),
  );
  const circles = cells.flatMap((cell) => {
    const density = cell.branchDensity + cell.labelDensity * 4;
    if (density === 0) return [];
    const ratio = Math.min(1, density / maximum);
    const red = Math.round(45 + ratio * 190);
    const green = Math.round(170 - ratio * 115);
    const radius = 12 + Math.sqrt(ratio) * 42;
    return [
      `<circle cx="${format(cell.center.x)}" cy="${format(cell.center.y)}" ` +
      `r="${format(radius)}" fill="rgb(${red} ${green} 70)" opacity=".34"/>`,
    ];
  }).join("\n");
  return injectBeforeSkeleton(
    botanicalStyle(baseSvg, "Lubanda Golden Dataset — BGI Density Heatmap"),
    `<g id="bgi-density-heatmap">${circles}</g>`,
  ).replace("<g id=\"skeleton\">", "<g id=\"skeleton\" opacity=\".28\">");
};

const maximumTurn = (curve: CubicBezier): number => {
  const samples = sampleCubicBezier(curve, { tolerance: 1, maxSubdivisionDepth: 8 });
  let total = 0;
  for (let index = 1; index < samples.length - 1; index += 1) {
    const a = samples[index - 1] as Vec2;
    const b = samples[index] as Vec2;
    const c = samples[index + 1] as Vec2;
    const left = { x: b.x - a.x, y: b.y - a.y };
    const right = { x: c.x - b.x, y: c.y - b.y };
    const denominator = Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y);
    if (denominator === 0) continue;
    total += Math.acos(Math.max(-1, Math.min(
      1,
      (left.x * right.x + left.y * right.y) / denominator,
    )));
  }
  return total;
};
const variance = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    values.length;
};
const entropy = (bins: readonly number[]): number => {
  const total = bins.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  const value = bins.reduce((sum, count) => {
    if (count === 0) return sum;
    const probability = count / total;
    return sum - probability * Math.log2(probability);
  }, 0);
  return value / Math.log2(bins.length);
};
const canopyMetrics = (
  plan: SkeletonPlan,
  territories: readonly Territory[],
  gridSize: number,
): Readonly<Record<string, number>> => {
  const nonTrunk = plan.branches.filter((branch) => branch.generation > 0);
  const branchByLineage = new Map<string, SkeletonBranch[]>();
  for (const branch of nonTrunk) {
    const list = branchByLineage.get(branch.metadata.lineageRootId) ?? [];
    list.push(branch);
    branchByLineage.set(branch.metadata.lineageRootId, list);
  }
  const allDensities: number[] = [];
  const occupancies: number[] = [];
  const symmetry: number[] = [];
  for (const territory of territories) {
    const bounds = boundsFromPoints(territory.polygon.points);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const cells = Array.from({ length: gridSize ** 2 }, () => 0);
    for (const branch of branchByLineage.get(territory.ownerLineageRootId) ?? []) {
      for (const point of sampleCubicBezier(branch.curve, {
        tolerance: Math.min(width, height) / 100,
        maxSubdivisionDepth: 9,
      })) {
        const column = Math.max(
          0,
          Math.min(gridSize - 1, Math.floor((point.x - bounds.minX) / width * gridSize)),
        );
        const row = Math.max(
          0,
          Math.min(gridSize - 1, Math.floor((point.y - bounds.minY) / height * gridSize)),
        );
        const index = row * gridSize + column;
        cells[index] = (cells[index] ?? 0) + 1;
      }
    }
    allDensities.push(...cells);
    occupancies.push(cells.filter((value) => value > 0).length / cells.length);
    let difference = 0;
    let total = 0;
    for (let row = 0; row < gridSize; row += 1) {
      for (let column = 0; column < Math.floor(gridSize / 2); column += 1) {
        const left = cells[row * gridSize + column] ?? 0;
        const right = cells[row * gridSize + gridSize - 1 - column] ?? 0;
        difference += Math.abs(left - right);
        total += left + right;
      }
    }
    symmetry.push(total === 0 ? 1 : Math.max(0, 1 - difference / total));
  }
  const angleBins = Array.from({ length: 12 }, () => 0);
  for (const branch of nonTrunk) {
    const tangent = {
      x: branch.curve.p3.x - branch.curve.p2.x,
      y: branch.curve.p3.y - branch.curve.p2.y,
    };
    const angle = (Math.atan2(tangent.y, tangent.x) + Math.PI * 2) %
      (Math.PI * 2);
    const index = Math.min(11, Math.floor(angle / (Math.PI * 2) * 12));
    angleBins[index] = (angleBins[index] ?? 0) + 1;
  }
  const lengths = nonTrunk.map((branch) => branch.length);
  return {
    territoryOccupancy: round(
      occupancies.reduce((sum, value) => sum + value, 0) /
        Math.max(1, occupancies.length),
    ),
    canopyDensityVariance: round(variance(allDensities)),
    branchAngleEntropy: round(entropy(angleBins)),
    averageCurvature: round(
      nonTrunk.reduce((sum, branch) => sum + maximumTurn(branch.curve), 0) /
        Math.max(1, nonTrunk.length),
    ),
    emptySpaceUtilization: round(
      allDensities.filter((value) => value > 0).length /
        Math.max(1, allDensities.length),
    ),
    branchLengthVariance: round(variance(lengths)),
    symmetryScore: round(
      symmetry.reduce((sum, value) => sum + value, 0) /
        Math.max(1, symmetry.length),
    ),
  };
};
const topologySignature = (plan: SkeletonPlan): string =>
  canonicalJson(plan.branches.map((branch) => ({
    id: branch.id,
    ownerPersonId: branch.ownerPersonId,
    parentBranchId: branch.parentBranchId,
    childrenBranchIds: branch.childrenBranchIds,
    territoryId: branch.territoryId,
    startNodeId: branch.startNodeId,
    endNodeId: branch.endNodeId,
    startPoint: branch.startPoint,
    endPoint: branch.endPoint,
  })));
const countLabelOverlaps = (layout: LabelLayoutResult): number => {
  const query = new LabelCollisionQuery();
  let count = 0;
  for (const placement of [...layout.placements].sort((left, right) =>
    left.placementId.localeCompare(right.placementId)
  )) {
    count += query.collisions(placement.bounds)
      .filter((collision) => collision.kind === "LABEL").length;
    query.addPlacement(placement);
  }
  return count;
};
const countWoodPenetrations = (
  layout: LabelLayoutResult,
  branches: readonly SkeletonBranch[],
): number => {
  const query = new LabelCollisionQuery({ clearance: 0 });
  for (const obstacle of buildSkeletonWoodObstacles(
    branches,
    DEFAULT_ENGINE_CONFIGURATION.collision.barkAllowance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.bezierSubdivisionTolerance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.maxSubdivisionDepth,
  )) query.addObstacle(obstacle);
  return layout.placements.filter((placement) => query.hasCollision(placement.bounds)).length;
};

const sourceBytes = await timed("readWorkbook", () => fs.readFile(workbookPath));
const sourceFileSha256Before = sha256Bytes(sourceBytes);
const imported = await timed("importWorkbook", () =>
  new XlsxGenealogyImporter().importWorkbook(
    sourceBytes.buffer.slice(
      sourceBytes.byteOffset,
      sourceBytes.byteOffset + sourceBytes.byteLength,
    ),
  ),
);
if (!imported.ok) throw new Error(`Golden import failed: ${JSON.stringify(imported.errors)}`);
const genealogyValidation = await timed("validateGenealogy", async () =>
  new GenealogyValidator().validate(imported.value)
);
if (!genealogyValidation.accepted) throw new Error("Golden genealogy rejected");
const snapshot = buildAcceptedGenealogySnapshot(genealogyValidation, {
  projectId: asProjectId("lubanda-golden-botanical-growth-intelligence"),
  revisionId: asRevisionId(`sha256:${imported.value.sourceChecksum}`),
  createdAt: "2026-07-29T00:00:00.000Z",
});
const graph = buildGenealogyGraph(snapshot);
const selectedRootId = graph.roots[0];
if (!selectedRootId) throw new Error("Golden Dataset has no root");
const demandPlan = await timed("demand", () =>
  new DeterministicDemandEngine().compute({
    graph,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
  })
);
const majorLineages = graph.childrenByParentId.get(selectedRootId) ?? [];
const demandById = new Map(demandPlan.results.map((result) => [result.personId, result]));
const requiredArea = majorLineages.reduce((sum, id) =>
  sum + Math.max(
    DEFAULT_ENGINE_CONFIGURATION.territory.minimumTerritoryArea,
    demandById.get(id)?.spatial.requiredArea ?? 0,
  ), 0);
const territoryResult = await timed("territories", () =>
  new DeterministicTerritoryPlanner().plan({
    graph,
    demandPlan,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    templateBoundary: createTemplate(requiredArea),
    configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
    seed,
  })
);
if (!territoryResult.ok) throw new Error("Golden territory plan rejected");
const baseSkeleton = await timed("baseSkeleton", () =>
  new DeterministicSkeletonGrowthEngine().grow({
    graph,
    demandPlan,
    territoryPlan: territoryResult.value,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
    seed,
  })
);
if (baseSkeleton.status !== "ACCEPTED") throw new Error("Golden skeleton rejected");
const arborIvy = await timed("arborIvy", () =>
  new BotanicalTerritoryGrowthEngine().grow({
    graph,
    skeletonPlan: baseSkeleton,
    territoryPlan: territoryResult.value,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  })
);
const currentLabels = await timed("currentLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: arborIvy.skeletonPlan,
    templatePolygon: territoryResult.value.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  })
);
if (currentLabels.status !== "ACCEPTED") throw new Error("Arbor-Ivy labels incomplete");
const intelligenceInput = {
  graph,
  skeletonPlan: arborIvy.skeletonPlan,
  territoryPlan: territoryResult.value,
  configuration: DEFAULT_ENGINE_CONFIGURATION,
  labelLayout: currentLabels,
} as const;
const intelligence = await timed("bgi", () =>
  new BotanicalGrowthIntelligenceEngine().guide(intelligenceInput)
);
const replayIntelligence = await timed("replayBgi", () =>
  new BotanicalGrowthIntelligenceEngine().guide(intelligenceInput)
);
const intelligentLabels = await timed("bgiLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: intelligence.skeletonPlan,
    templatePolygon: territoryResult.value.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  })
);
if (intelligentLabels.status !== "ACCEPTED") throw new Error("BGI labels incomplete");
const relaxation = {
  maxIterations: 8,
  initialStepRatio: 0.02,
  maximumControlPointMovement: 4,
  preserveLabelPlacements: false,
} as const;
const polished = await timed("localRelaxation", () =>
  new BotanicalLocalRelaxationEngine().relax({
    graph,
    skeletonPlan: intelligence.skeletonPlan,
    territoryPlan: territoryResult.value,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
    labelLayout: intelligentLabels,
    relaxation,
  })
);
const replayLabels = await timed("replayLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: replayIntelligence.skeletonPlan,
    templatePolygon: territoryResult.value.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  })
);
const replayPolished = await timed("replayLocalRelaxation", () =>
  new BotanicalLocalRelaxationEngine().relax({
    graph,
    skeletonPlan: replayIntelligence.skeletonPlan,
    territoryPlan: territoryResult.value,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
    labelLayout: replayLabels,
    relaxation,
  })
);
const finalSkeleton = polished.skeletonPlan;
const finalLabels = polished.labelLayout;
const validator = new SkeletonValidator();
const territoryPolygons = new Map(territoryResult.value.territories.map(
  (territory) => [territory.id, territory.polygon],
));
const validation = await timed("validateFinal", async () =>
  validator.validate(
    finalSkeleton,
    graph,
    selectedRootId,
    territoryResult.value.templatePolygon,
    territoryPolygons,
  )
);
const exporter = new VisualPreviewExporter();
const currentPreview = await timed("currentSvg", () => exporter.export({
  graph,
  skeletonPlan: arborIvy.skeletonPlan,
  labelLayout: currentLabels,
  templatePolygon: territoryResult.value.templatePolygon,
}));
const resultPreview = await timed("resultSvg", () => exporter.export({
  graph,
  skeletonPlan: finalSkeleton,
  labelLayout: finalLabels,
  templatePolygon: territoryResult.value.templatePolygon,
}));
const currentSvg = botanicalStyle(
  currentPreview.svg,
  "Lubanda Golden Dataset — Current Arbor-Ivy",
);
const resultSvg = botanicalStyle(
  resultPreview.svg,
  "Lubanda Golden Dataset — Botanical Growth Intelligence",
);
const overlaySvg = differenceOverlay(
  arborIvy.skeletonPlan,
  finalSkeleton,
  resultPreview.svg,
);
const vectorsSvg = growthVectorSvg(intelligence.growthVectors, resultPreview.svg);
const heatmapSvg = densityHeatmapSvg(intelligence.densityCells, resultPreview.svg);
const currentPng = await timed("currentPng", async () => rasterize(currentSvg));
const resultPng = await timed("resultPng", async () => rasterize(resultSvg));
const overlayPng = await timed("overlayPng", async () => rasterize(overlaySvg));
const vectorsPng = await timed("vectorsPng", async () => rasterize(vectorsSvg));
const heatmapPng = await timed("heatmapPng", async () => rasterize(heatmapSvg));
const sourceFileSha256After = sha256Bytes(await fs.readFile(workbookPath));
const beforeMetrics = canopyMetrics(
  arborIvy.skeletonPlan,
  territoryResult.value.territories,
  18,
);
const afterMetrics = canopyMetrics(
  finalSkeleton,
  territoryResult.value.territories,
  18,
);
const labelOverlaps = countLabelOverlaps(finalLabels);
const woodPenetrations = countWoodPenetrations(finalLabels, finalSkeleton.branches);
const deterministicReplayMatched =
  intelligence.deterministicFingerprint === replayIntelligence.deterministicFingerprint &&
  polished.deterministicFingerprint === replayPolished.deterministicFingerprint &&
  canonicalJson(finalLabels.placements) ===
    canonicalJson(replayPolished.labelLayout.placements);
const movedBranches = finalSkeleton.branches.filter((branch, index) =>
  canonicalJson(branch.curve) !==
    canonicalJson(arborIvy.skeletonPlan.branches[index]?.curve)
).length;
const metrics = {
  territoryOccupancy: {
    before: beforeMetrics.territoryOccupancy,
    after: afterMetrics.territoryOccupancy,
  },
  canopyDensityVariance: {
    before: beforeMetrics.canopyDensityVariance,
    after: afterMetrics.canopyDensityVariance,
  },
  branchAngleEntropy: {
    before: beforeMetrics.branchAngleEntropy,
    after: afterMetrics.branchAngleEntropy,
  },
  averageCurvature: {
    before: beforeMetrics.averageCurvature,
    after: afterMetrics.averageCurvature,
  },
  emptySpaceUtilization: {
    before: beforeMetrics.emptySpaceUtilization,
    after: afterMetrics.emptySpaceUtilization,
  },
  branchLengthVariance: {
    before: beforeMetrics.branchLengthVariance,
    after: afterMetrics.branchLengthVariance,
  },
  symmetryScore: {
    before: beforeMetrics.symmetryScore,
    after: afterMetrics.symmetryScore,
  },
  movedBranches,
  acceptedIntensity: intelligence.metrics.acceptedIntensity,
  growthVectorCount: intelligence.growthVectors.length,
};
const deterministicFingerprint = await sha256Canonical({
  milestone: "BOTANICAL_GROWTH_INTELLIGENCE",
  sourceFileSha256Before,
  arborIvyFingerprint: arborIvy.deterministicFingerprint,
  intelligenceFingerprint: intelligence.deterministicFingerprint,
  localRelaxationFingerprint: polished.deterministicFingerprint,
  finalLabels: finalLabels.placements,
  metrics,
});
const report = {
  schemaVersion: "1.0",
  milestone: "BOTANICAL_GROWTH_INTELLIGENCE",
  sourceFileName: path.basename(workbookPath),
  sourceFileSha256Before,
  sourceFileSha256After,
  sourceDatasetUnchanged: sourceFileSha256Before === sourceFileSha256After,
  totalPeople: genealogyValidation.statistics.acceptedPersonCount,
  totalBranches: finalSkeleton.branches.length,
  invariants: {
    genealogyUnchanged: snapshot.sourceChecksum === imported.value.sourceChecksum,
    topologyAndOwnershipUnchanged:
      topologySignature(arborIvy.skeletonPlan) === topologySignature(finalSkeleton),
    territoriesUnchanged:
      finalSkeleton.territoryPlanFingerprint ===
        arborIvy.skeletonPlan.territoryPlanFingerprint,
    deterministicReplayMatched,
  },
  validation: {
    skeletonAccepted: validation.accepted,
    branchIntersections: validation.metrics.intersectionCount,
    outOfBoundsBranches: validation.metrics.outOfBoundsCount,
    labelOverlaps,
    woodPenetrations,
    unresolvedLabels: finalLabels.metrics.unresolvedLabelCount,
  },
  metrics,
  localRelaxation: {
    status: polished.status,
    movedBranchCount: polished.metrics.movedBranchCount,
    acceptedIterationCount: polished.metrics.acceptedIterationCount,
    deterministicFingerprint: polished.deterministicFingerprint,
  },
  artifacts: {
    currentArborIvySvg: path.relative(process.cwd(), currentSvgPath),
    currentArborIvyPng: path.relative(process.cwd(), currentPngPath),
    bgiResultSvg: path.relative(process.cwd(), resultSvgPath),
    bgiResultPng: path.relative(process.cwd(), resultPngPath),
    differenceOverlaySvg: path.relative(process.cwd(), overlayPath),
    differenceOverlayPng: path.relative(process.cwd(), overlayPngPath),
    growthVectorsSvg: path.relative(process.cwd(), vectorsPath),
    growthVectorsPng: path.relative(process.cwd(), vectorsPngPath),
    densityHeatmapSvg: path.relative(process.cwd(), heatmapPath),
    densityHeatmapPng: path.relative(process.cwd(), heatmapPngPath),
    currentSvgSha256: sha256Bytes(new TextEncoder().encode(currentSvg)),
    resultSvgSha256: sha256Bytes(new TextEncoder().encode(resultSvg)),
    currentPngSha256: sha256Bytes(currentPng),
    resultPngSha256: sha256Bytes(resultPng),
    overlayPngSha256: sha256Bytes(overlayPng),
    vectorsPngSha256: sha256Bytes(vectorsPng),
    heatmapPngSha256: sha256Bytes(heatmapPng),
  },
  deterministicFingerprint,
  totalRuntimeMilliseconds: round(performance.now() - started),
  peakMemoryUsageBytes: process.resourceUsage().maxRSS * 1_024,
  stageRuntimesMilliseconds: stages,
};
if (
  !report.sourceDatasetUnchanged ||
  !Object.values(report.invariants).every(Boolean) ||
  !report.validation.skeletonAccepted ||
  report.validation.branchIntersections !== 0 ||
  report.validation.outOfBoundsBranches !== 0 ||
  report.validation.labelOverlaps !== 0 ||
  report.validation.woodPenetrations !== 0 ||
  report.validation.unresolvedLabels !== 0 ||
  report.metrics.movedBranches === 0
) {
  throw new Error(`Golden BGI E2E failed: ${JSON.stringify(report, null, 2)}`);
}
await fs.mkdir(outputDirectory, { recursive: true });
await Promise.all([
  fs.writeFile(currentSvgPath, currentSvg, "utf8"),
  fs.writeFile(currentPngPath, currentPng),
  fs.writeFile(resultSvgPath, resultSvg, "utf8"),
  fs.writeFile(resultPngPath, resultPng),
  fs.writeFile(overlayPath, overlaySvg, "utf8"),
  fs.writeFile(overlayPngPath, overlayPng),
  fs.writeFile(vectorsPath, vectorsSvg, "utf8"),
  fs.writeFile(vectorsPngPath, vectorsPng),
  fs.writeFile(heatmapPath, heatmapSvg, "utf8"),
  fs.writeFile(heatmapPngPath, heatmapPng),
  fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
]);
console.log(reportPath);
