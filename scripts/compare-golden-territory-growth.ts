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
import { BotanicalLocalRelaxationEngine } from "../src/core/growth/index.js";
import {
  sampleCubicBezier,
} from "../src/core/geometry/bezier.js";
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
import {
  VisualPreviewExporter,
  type BranchLengthDistribution,
} from "../src/core/preview/index.js";
import {
  DeterministicSkeletonGrowthEngine,
  type SkeletonBranch,
  type SkeletonPlan,
} from "../src/core/skeleton/index.js";
import {
  BotanicalTerritoryGrowthEngine,
} from "../src/core/territory-growth/index.js";
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
  process.env.LUBANDA_TERRITORY_GROWTH_OUTPUT_DIR ?? "artifacts",
);
const artifact = (suffix: string): string =>
  path.join(outputDirectory, `golden-botanical-territory-growth-${suffix}`);
const beforeSvgPath = artifact("before.svg");
const afterSvgPath = artifact("after.svg");
const beforePngPath = artifact("before.png");
const afterPngPath = artifact("after.png");
const overlayPath = artifact("overlay.svg");
const reportPath = artifact("comparison-report.json");
const seed = 1_386;
const started = performance.now();
const stageRuntimesMilliseconds: Record<string, number> = {};
const DECIMAL_PLACES = 6;
const PNG_WIDTH = 4_096;

const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
  const stageStarted = performance.now();
  try {
    return await operation();
  } finally {
    stageRuntimesMilliseconds[name] =
      Math.round((performance.now() - stageStarted) * 1_000) / 1_000;
  }
};
const round = (value: number): number =>
  Math.round(value * 10 ** DECIMAL_PLACES) / 10 ** DECIMAL_PLACES;
const format = (value: number): string =>
  Number.isInteger(round(value))
    ? round(value).toString()
    : round(value).toFixed(DECIMAL_PLACES).replace(/0+$/, "").replace(/\.$/, "");
const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
const rasterizeSvg = (svg: string): Uint8Array =>
  new Resvg(svg, {
    background: "#ffffff",
    fitTo: { mode: "width", value: PNG_WIDTH },
    font: { defaultFontFamily: "DejaVu Sans", loadSystemFonts: true },
  }).render().asPng();
const createTemplateBoundary = (requiredMajorArea: number): TemplateBoundary => {
  const templateArea = Math.max(144_000_000, requiredMajorArea * 6);
  const width = Math.max(6_000, Math.sqrt(templateArea * 1.6));
  const height = Math.max(4_000, templateArea / width);
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
const branchPath = (branch: SkeletonBranch): string =>
  `M ${format(branch.curve.p0.x)} ${format(branch.curve.p0.y)} ` +
  `C ${format(branch.curve.p1.x)} ${format(branch.curve.p1.y)} ` +
  `${format(branch.curve.p2.x)} ${format(branch.curve.p2.y)} ` +
  `${format(branch.curve.p3.x)} ${format(branch.curve.p3.y)}`;
const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
const botanicalStyle = (svg: string, title: string): string =>
  svg
    .replace("Lubanda Golden Dataset — Visual Validation Preview", title)
    .replace(
      ".branch-recovery{stroke:#d97706;stroke-dasharray:9 6;opacity:.82}",
      ".branch-recovery{stroke:#246b45;opacity:.88}",
    )
    .replace("Recovery branches:", "Genealogical branches:");

const movedBranches = (
  before: SkeletonPlan,
  after: SkeletonPlan,
): readonly { readonly before: SkeletonBranch; readonly after: SkeletonBranch }[] => {
  const afterById = new Map(after.branches.map((branch) => [branch.id, branch]));
  return [...before.branches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((beforeBranch) => {
      const afterBranch = afterById.get(beforeBranch.id);
      if (!afterBranch) throw new Error(`Growth removed ${beforeBranch.id}`);
      return canonicalJson(beforeBranch.curve) === canonicalJson(afterBranch.curve)
        ? []
        : [{ before: beforeBranch, after: afterBranch }];
    });
};
const buildOverlay = (
  afterSvg: string,
  moved: ReturnType<typeof movedBranches>,
): string => {
  const paths = moved.map(({ before, after }) => {
    const width = Math.max(
      1.5,
      (after.thickness.baseThickness + after.thickness.tipThickness) / 2,
    );
    return [
      `<g data-moved-branch-id="${escapeXml(after.id)}">`,
      `<path d="${branchPath(before)}" fill="none" stroke="#f97316" ` +
        `stroke-width="${format(width + 1)}" stroke-dasharray="10 7" opacity=".52"/>`,
      `<path d="${branchPath(after)}" fill="none" stroke="#15803d" ` +
        `stroke-width="${format(width + 1)}" opacity=".84"/>`,
      `<line x1="${format(before.endPoint.x)}" y1="${format(before.endPoint.y)}" ` +
        `x2="${format(after.endPoint.x)}" y2="${format(after.endPoint.y)}" ` +
        `stroke="#2563eb" stroke-width="1.1" opacity=".48"/>`,
      "</g>",
    ].join("");
  }).join("\n");
  return botanicalStyle(afterSvg, "Lubanda Golden Dataset — Territory Growth Overlay")
    .replace(
      `<g id="skeleton">`,
      `<g id="growth-overlay">${paths}</g>\n<g id="skeleton" opacity=".24">`,
    );
};

const directionDistribution = (
  branches: readonly SkeletonBranch[],
): Readonly<Record<string, number>> => {
  const bins = {
    right: 0, downRight: 0, down: 0, downLeft: 0,
    left: 0, upLeft: 0, up: 0, upRight: 0,
  };
  const names = Object.keys(bins) as (keyof typeof bins)[];
  for (const branch of branches.filter((item) => item.generation > 0)) {
    const angle = Math.atan2(
      branch.endPoint.y - branch.startPoint.y,
      branch.endPoint.x - branch.startPoint.x,
    );
    const index = Math.round((angle + Math.PI * 2) / (Math.PI / 4)) % 8;
    bins[names[index] as keyof typeof bins] += 1;
  }
  return bins;
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
const averagePathCurvature = (branches: readonly SkeletonBranch[]): number =>
  round(branches.reduce((sum, branch) => sum + maximumTurn(branch.curve), 0) /
    Math.max(1, branches.length));
const lineageBranches = (
  branches: readonly SkeletonBranch[],
  lineageRootId: string,
): readonly SkeletonBranch[] =>
  branches.filter((branch) =>
    branch.generation > 0 && branch.metadata.lineageRootId === lineageRootId
  );
const territoryOccupancy = (
  branches: readonly SkeletonBranch[],
  territories: readonly Territory[],
): number => {
  const GRID = 16;
  const ratios = territories.flatMap((territory) => {
    const bounds = boundsFromPoints(territory.polygon.points);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const lineage = lineageBranches(branches, territory.ownerLineageRootId);
    if (lineage.length === 0) return [];
    const occupied = new Set<string>();
    for (const branch of lineage) {
      for (const sample of sampleCubicBezier(branch.curve, {
        tolerance: Math.min(width, height) / 80,
        maxSubdivisionDepth: 9,
      })) {
        const x = Math.max(0, Math.min(GRID - 1,
          Math.floor((sample.x - bounds.minX) / width * GRID)));
        const y = Math.max(0, Math.min(GRID - 1,
          Math.floor((sample.y - bounds.minY) / height * GRID)));
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (x + dx >= 0 && x + dx < GRID && y + dy >= 0 && y + dy < GRID) {
              occupied.add(`${x + dx}:${y + dy}`);
            }
          }
        }
      }
    }
    return [occupied.size / (GRID * GRID)];
  });
  return round(ratios.reduce((sum, value) => sum + value, 0) /
    Math.max(1, ratios.length));
};
const emptySpaceUtilization = (
  branches: readonly SkeletonBranch[],
  territories: readonly Territory[],
): number => {
  const GRID = 24;
  const ratios = territories.flatMap((territory) => {
    const bounds = boundsFromPoints(territory.polygon.points);
    const width = Math.max(1, bounds.maxX - bounds.minX);
    const height = Math.max(1, bounds.maxY - bounds.minY);
    const occupied = new Set<string>();
    for (const branch of lineageBranches(branches, territory.ownerLineageRootId)) {
      for (const sample of sampleCubicBezier(branch.curve, {
        tolerance: Math.min(width, height) / 100,
        maxSubdivisionDepth: 9,
      })) {
        const x = Math.max(0, Math.min(GRID - 1,
          Math.floor((sample.x - bounds.minX) / width * GRID)));
        const y = Math.max(0, Math.min(GRID - 1,
          Math.floor((sample.y - bounds.minY) / height * GRID)));
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (x + dx >= 0 && x + dx < GRID && y + dy >= 0 && y + dy < GRID) {
              occupied.add(`${x + dx}:${y + dy}`);
            }
          }
        }
      }
    }
    return [occupied.size / (GRID * GRID)];
  });
  return round(ratios.reduce((sum, value) => sum + value, 0) /
    Math.max(1, ratios.length));
};
const topologySignature = (plan: SkeletonPlan): string =>
  canonicalJson([...plan.branches].sort((a, b) => a.id.localeCompare(b.id)).map(
    (branch) => ({
      id: branch.id,
      ownerPersonId: branch.ownerPersonId,
      parentBranchId: branch.parentBranchId,
      childrenBranchIds: [...branch.childrenBranchIds],
      startNodeId: branch.startNodeId,
      endNodeId: branch.endNodeId,
    }),
  ));
const labelIdentitySignature = (layout: LabelLayoutResult): string =>
  canonicalJson(layout.placements.map((placement) => ({
    personId: placement.personId,
    displayName: placement.displayName,
  })).sort((a, b) => a.personId.localeCompare(b.personId)));
const countLabelOverlaps = (layout: LabelLayoutResult): number => {
  const query = new LabelCollisionQuery();
  let count = 0;
  for (const placement of [...layout.placements].sort((a, b) =>
    a.placementId.localeCompare(b.placementId)
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
  return layout.placements.filter((placement) =>
    query.hasCollision(placement.bounds)
  ).length;
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
  projectId: asProjectId("lubanda-golden-botanical-territory-growth"),
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
const majorLineageIds = graph.childrenByParentId.get(selectedRootId) ?? [];
const demandById = new Map(demandPlan.results.map((item) => [item.personId, item]));
const requiredMajorArea = majorLineageIds.reduce((sum, id) =>
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
    templateBoundary: createTemplateBoundary(requiredMajorArea),
    configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
    seed,
  })
);
if (!territoryResult.ok) throw new Error("Golden territory plan rejected");
const beforeSkeleton = await timed("growExistingSkeleton", () =>
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
if (beforeSkeleton.status !== "ACCEPTED") throw new Error("Golden skeleton rejected");
const beforeLabels = await timed("placeBeforeLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: beforeSkeleton,
    templatePolygon: territoryResult.value.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  })
);
if (beforeLabels.status !== "ACCEPTED") throw new Error("Before labels incomplete");
const growthInput = {
  graph,
  skeletonPlan: beforeSkeleton,
  territoryPlan: territoryResult.value,
  configuration: DEFAULT_ENGINE_CONFIGURATION,
};
const growth = await timed("growBotanicalTerritories", () =>
  new BotanicalTerritoryGrowthEngine().grow(growthInput)
);
const replay = await timed("replayBotanicalTerritories", () =>
  new BotanicalTerritoryGrowthEngine().grow(growthInput)
);
const growthLabels = await timed("placeGrowthLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: growth.skeletonPlan,
    templatePolygon: territoryResult.value.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  })
);
if (growthLabels.status !== "ACCEPTED") {
  throw new Error(`Growth labels incomplete: ${growthLabels.metrics.unresolvedLabelCount}`);
}
const replayGrowthLabels = await timed("placeReplayGrowthLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: replay.skeletonPlan,
    templatePolygon: territoryResult.value.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  })
);
const relaxationConfig = {
  maxIterations: 8,
  initialStepRatio: 0.02,
  maximumControlPointMovement: 4,
  preserveLabelPlacements: false,
} as const;
const polished = await timed("localRelaxation", () =>
  new BotanicalLocalRelaxationEngine().relax({
    graph,
    skeletonPlan: growth.skeletonPlan,
    territoryPlan: territoryResult.value,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
    labelLayout: growthLabels,
    relaxation: relaxationConfig,
  })
);
const replayPolished = await timed("replayLocalRelaxation", () =>
  new BotanicalLocalRelaxationEngine().relax({
    graph,
    skeletonPlan: replay.skeletonPlan,
    territoryPlan: territoryResult.value,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
    labelLayout: replayGrowthLabels,
    relaxation: relaxationConfig,
  })
);
const afterSkeleton = polished.skeletonPlan;
const afterLabels = polished.labelLayout;
const replayLabels = replayPolished.labelLayout;
const exporter = new VisualPreviewExporter();
const beforePreview = await timed("beforeSvg", () => exporter.export({
  graph, skeletonPlan: beforeSkeleton, labelLayout: beforeLabels,
  templatePolygon: territoryResult.value.templatePolygon,
}));
const afterPreview = await timed("afterSvg", () => exporter.export({
  graph, skeletonPlan: afterSkeleton, labelLayout: afterLabels,
  templatePolygon: territoryResult.value.templatePolygon,
}));
const replayPreview = await timed("replaySvg", () => exporter.export({
  graph, skeletonPlan: replayPolished.skeletonPlan, labelLayout: replayLabels,
  templatePolygon: territoryResult.value.templatePolygon,
}));
const beforeSvg = botanicalStyle(
  beforePreview.svg,
  "Lubanda Golden Dataset — Before Territory Growth",
);
const afterSvg = botanicalStyle(
  afterPreview.svg,
  "Lubanda Golden Dataset — After Territory Growth",
);
const replaySvg = botanicalStyle(
  replayPreview.svg,
  "Lubanda Golden Dataset — After Territory Growth",
);
const beforePng = await timed("beforePng", async () => rasterizeSvg(beforeSvg));
const afterPng = await timed("afterPng", async () => rasterizeSvg(afterSvg));
const replayPng = await timed("replayPng", async () => rasterizeSvg(replaySvg));
const moved = movedBranches(beforeSkeleton, afterSkeleton);
const overlaySvg = await timed("overlaySvg", async () =>
  buildOverlay(afterPreview.svg, moved)
);
const territoryOccupancyBefore = territoryOccupancy(
  beforeSkeleton.branches, territoryResult.value.territories,
);
const territoryOccupancyAfter = territoryOccupancy(
  afterSkeleton.branches, territoryResult.value.territories,
);
const emptySpaceUtilizationBefore = emptySpaceUtilization(
  beforeSkeleton.branches, territoryResult.value.territories,
);
const emptySpaceUtilizationAfter = emptySpaceUtilization(
  afterSkeleton.branches, territoryResult.value.territories,
);
const territoryPolygons = new Map(territoryResult.value.territories.map(
  (territory) => [territory.id, territory.polygon],
));
const finalValidation = await timed("validateAfterSkeleton", async () =>
  new SkeletonValidator().validate(
    afterSkeleton, graph, selectedRootId,
    territoryResult.value.templatePolygon, territoryPolygons,
  )
);
const labelOverlaps = countLabelOverlaps(afterLabels);
const woodPenetrations = countWoodPenetrations(afterLabels, afterSkeleton.branches);
const sourceFileSha256After = sha256Bytes(await fs.readFile(workbookPath));
const deterministicReplayMatched =
  replay.deterministicFingerprint === growth.deterministicFingerprint &&
  replayPolished.deterministicFingerprint === polished.deterministicFingerprint &&
  canonicalJson(replayLabels.placements) === canonicalJson(afterLabels.placements) &&
  replaySvg === afterSvg &&
  sha256Bytes(replayPng) === sha256Bytes(afterPng);
const metrics = {
  territoryOccupancy: {
    before: territoryOccupancyBefore,
    after: territoryOccupancyAfter,
  },
  branchAngleDistribution: {
    before: directionDistribution(beforeSkeleton.branches),
    after: directionDistribution(afterSkeleton.branches),
  },
  branchLengthDistribution: {
    before: beforePreview.metrics.branchLengthDistribution as BranchLengthDistribution,
    after: afterPreview.metrics.branchLengthDistribution as BranchLengthDistribution,
  },
  branchHierarchyStatistics: growth.metrics.branchHierarchy,
  emptySpaceUtilization: {
    before: emptySpaceUtilizationBefore,
    after: emptySpaceUtilizationAfter,
  },
  averagePathCurvature: {
    before: averagePathCurvature(beforeSkeleton.branches),
    after: averagePathCurvature(afterSkeleton.branches),
  },
  numberOfPrimaryBranches: growth.metrics.primaryBranchCount,
  numberOfSecondaryBranches: growth.metrics.secondaryBranchCount,
  averageTwigDepth: growth.metrics.averageTwigDepth,
};
const deterministicFingerprint = await sha256Canonical({
  milestone: "BOTANICAL_TERRITORY_GROWTH",
  sourceFileSha256Before,
  sourceSkeletonFingerprint: beforeSkeleton.deterministicFingerprint,
  territoryGrowthFingerprint: growth.deterministicFingerprint,
  localRelaxationFingerprint: polished.deterministicFingerprint,
  afterLabels: afterLabels.placements,
  metrics,
});
const report = {
  schemaVersion: "1.0",
  milestone: "BOTANICAL_TERRITORY_GROWTH",
  sourceFileName: path.basename(workbookPath),
  sourceFileSha256Before,
  sourceFileSha256After,
  sourceDatasetUnchanged: sourceFileSha256Before === sourceFileSha256After,
  totalPeople: genealogyValidation.statistics.acceptedPersonCount,
  totalBranches: beforeSkeleton.branches.length,
  movedBranches: moved.length,
  invariants: {
    genealogyUnchanged: snapshot.sourceChecksum === imported.value.sourceChecksum,
    topologyUnchanged: topologySignature(beforeSkeleton) === topologySignature(afterSkeleton),
    parentChildRelationshipsUnchanged:
      canonicalJson(snapshot.persons.map(({ id, parentId }) => ({ id, parentId }))) ===
      canonicalJson(snapshot.persons.map(({ id, parentId }) => ({ id, parentId }))),
    branchIdentitiesUnchanged:
      canonicalJson(beforeSkeleton.branches.map((branch) => branch.id).sort()) ===
      canonicalJson(afterSkeleton.branches.map((branch) => branch.id).sort()),
    labelsUnchanged: labelIdentitySignature(beforeLabels) === labelIdentitySignature(afterLabels),
    deterministicReplayMatched,
  },
  validation: {
    afterSkeletonAccepted: finalValidation.accepted,
    branchIntersections: finalValidation.metrics.intersectionCount,
    outOfBoundsBranches: finalValidation.metrics.outOfBoundsCount,
    labelOverlaps,
    woodPenetrations,
    unresolvedLabels: afterLabels.metrics.unresolvedLabelCount,
  },
  metrics,
  artifacts: {
    beforeSvg: path.relative(process.cwd(), beforeSvgPath),
    afterSvg: path.relative(process.cwd(), afterSvgPath),
    beforePng: path.relative(process.cwd(), beforePngPath),
    afterPng: path.relative(process.cwd(), afterPngPath),
    overlaySvg: path.relative(process.cwd(), overlayPath),
    beforeSvgSha256: sha256Bytes(new TextEncoder().encode(beforeSvg)),
    afterSvgSha256: sha256Bytes(new TextEncoder().encode(afterSvg)),
    beforePngSha256: sha256Bytes(beforePng),
    afterPngSha256: sha256Bytes(afterPng),
    overlaySvgSha256: sha256Bytes(new TextEncoder().encode(overlaySvg)),
  },
  deterministicFingerprint,
  territoryGrowthDeterministicFingerprint: growth.deterministicFingerprint,
  localRelaxation: {
    status: polished.status,
    movedBranchCount: polished.metrics.movedBranchCount,
    acceptedIterationCount: polished.metrics.acceptedIterationCount,
    deterministicFingerprint: polished.deterministicFingerprint,
  },
  deterministicReplayMatched,
  totalRuntimeMilliseconds: round(performance.now() - started),
  peakMemoryUsageBytes: process.resourceUsage().maxRSS * 1_024,
  stageRuntimesMilliseconds,
};
if (
  !report.sourceDatasetUnchanged ||
  report.movedBranches === 0 ||
  !Object.values(report.invariants).every(Boolean) ||
  !report.validation.afterSkeletonAccepted ||
  report.validation.branchIntersections !== 0 ||
  report.validation.outOfBoundsBranches !== 0 ||
  report.validation.labelOverlaps !== 0 ||
  report.validation.woodPenetrations !== 0 ||
  report.validation.unresolvedLabels !== 0
) {
  throw new Error(`Golden Botanical Territory Growth E2E failed: ${JSON.stringify(report, null, 2)}`);
}
await fs.mkdir(outputDirectory, { recursive: true });
await Promise.all([
  fs.writeFile(beforeSvgPath, beforeSvg, "utf8"),
  fs.writeFile(afterSvgPath, afterSvg, "utf8"),
  fs.writeFile(beforePngPath, beforePng),
  fs.writeFile(afterPngPath, afterPng),
  fs.writeFile(overlayPath, overlaySvg, "utf8"),
  fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
]);
console.log(reportPath);
