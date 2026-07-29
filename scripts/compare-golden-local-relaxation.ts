import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Resvg } from "@resvg/resvg-js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import {
  asProjectId,
  asRevisionId,
} from "../src/core/contracts/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import { canonicalJson, sha256Canonical } from "../src/core/determinism/index.js";
import {
  buildAcceptedGenealogySnapshot,
  buildGenealogyGraph,
} from "../src/core/genealogy/index.js";
import {
  BotanicalLocalRelaxationEngine,
} from "../src/core/growth/index.js";
import {
  evaluateCubicBezier,
  sampleCubicBezier,
} from "../src/core/geometry/bezier.js";
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
  throw new Error(
    "Set LUBANDA_GOLDEN_WORKBOOK or pass the Golden Dataset .xlsx path",
  );
}

const outputDirectory = path.resolve(
  process.env.LUBANDA_RELAXATION_OUTPUT_DIR ?? "artifacts",
);
const beforeSvgPath = path.join(
  outputDirectory,
  "golden-local-relaxation-before.svg",
);
const afterSvgPath = path.join(
  outputDirectory,
  "golden-local-relaxation-after.svg",
);
const beforePngPath = path.join(
  outputDirectory,
  "golden-local-relaxation-before.png",
);
const afterPngPath = path.join(
  outputDirectory,
  "golden-local-relaxation-after.png",
);
const overlayPath = path.join(
  outputDirectory,
  "golden-local-relaxation-overlay.svg",
);
const reportPath = path.join(
  outputDirectory,
  "golden-local-relaxation-comparison-report.json",
);

const seed = 1_386;
const PNG_WIDTH = 4_096;
const DECIMAL_PLACES = 6;
const started = performance.now();
const stageRuntimesMilliseconds: Record<string, number> = {};

const timed = async <T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> => {
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

const format = (value: number): string => {
  const rounded = round(value);
  return Number.isInteger(rounded)
    ? rounded.toString()
    : rounded.toFixed(DECIMAL_PLACES).replace(/0+$/, "").replace(/\.$/, "");
};

const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

const rasterizeSvg = (svg: string): Uint8Array =>
  new Resvg(svg, {
    background: "#ffffff",
    fitTo: { mode: "width", value: PNG_WIDTH },
    font: {
      defaultFontFamily: "DejaVu Sans",
      loadSystemFonts: true,
    },
  }).render().asPng();

const createTemplateBoundary = (
  requiredMajorArea: number,
): TemplateBoundary => {
  const templateArea = Math.max(24_000_000, requiredMajorArea * 2.5);
  const width = Math.max(6_000, Math.sqrt(templateArea * 1.6));
  const height = Math.max(4_000, templateArea / width);
  return {
    kind: "POLYGON",
    polygon: {
      points: [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: width, y: height },
        { x: 0, y: height },
      ],
    },
  };
};

const branchMap = (
  branches: readonly SkeletonBranch[],
): ReadonlyMap<string, SkeletonBranch> =>
  new Map(branches.map((branch) => [branch.id, branch]));

const pointDistance = (left: Vec2, right: Vec2): number =>
  Math.hypot(left.x - right.x, left.y - right.y);

const movedBranches = (
  before: SkeletonPlan,
  after: SkeletonPlan,
): readonly {
  readonly before: SkeletonBranch;
  readonly after: SkeletonBranch;
  readonly p1Displacement: number;
  readonly p2Displacement: number;
}[] => {
  const afterById = branchMap(after.branches);
  return [...before.branches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .flatMap((beforeBranch) => {
      const afterBranch = afterById.get(beforeBranch.id);
      if (!afterBranch) {
        throw new Error(`Relaxation removed branch identity ${beforeBranch.id}`);
      }
      const p1Displacement = pointDistance(
        beforeBranch.curve.p1,
        afterBranch.curve.p1,
      );
      const p2Displacement = pointDistance(
        beforeBranch.curve.p2,
        afterBranch.curve.p2,
      );
      return p1Displacement === 0 && p2Displacement === 0
        ? []
        : [{
            before: beforeBranch,
            after: afterBranch,
            p1Displacement,
            p2Displacement,
          }];
    });
};

const maxCurveTurn = (curve: CubicBezier): number => {
  const samples = sampleCubicBezier(curve, {
    tolerance: 1,
    maxSubdivisionDepth: 8,
  });
  let maximum = 0;
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1] as Vec2;
    const current = samples[index] as Vec2;
    const next = samples[index + 1] as Vec2;
    const left = {
      x: current.x - previous.x,
      y: current.y - previous.y,
    };
    const right = {
      x: next.x - current.x,
      y: next.y - current.y,
    };
    const denominator =
      Math.hypot(left.x, left.y) * Math.hypot(right.x, right.y);
    if (denominator <= Number.EPSILON) continue;
    const cosine = Math.max(
      -1,
      Math.min(1, (left.x * right.x + left.y * right.y) / denominator),
    );
    maximum = Math.max(maximum, Math.acos(cosine));
  }
  return maximum;
};

const averageCurvature = (branches: readonly SkeletonBranch[]): number =>
  round(
    branches.length === 0
      ? 0
      : branches.reduce(
          (sum, branch) => sum + maxCurveTurn(branch.curve),
          0,
        ) / branches.length,
  );

const territoryOccupancy = (
  branches: readonly SkeletonBranch[],
  territories: readonly Territory[],
): number => {
  const territoriesById = new Map<string, Territory>(
    territories.flatMap((territory) => [
      [territory.id, territory] as const,
      [`lineage:${territory.ownerLineageRootId}`, territory] as const,
    ]),
  );
  const contributions = branches.flatMap((branch) => {
    if (branch.generation === 0) return [];
    const territory = branch.territoryId === null
      ? territoriesById.get(`lineage:${branch.metadata.lineageRootId}`)
      : territoriesById.get(branch.territoryId);
    if (!territory) return [];
    const midpoint = evaluateCubicBezier(branch.curve, 0.5);
    const radius = Math.max(
      1,
      ...territory.polygon.points.map((point) =>
        pointDistance(point, territory.centroid)
      ),
    );
    return [
      Math.max(
        0,
        1 - pointDistance(midpoint, territory.centroid) / radius,
      ),
    ];
  });
  return round(
    contributions.length === 0
      ? 0
      : contributions.reduce((sum, value) => sum + value, 0) /
          contributions.length,
  );
};

const topologySignature = (plan: SkeletonPlan): string =>
  canonicalJson(
    [...plan.branches]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((branch) => ({
        id: branch.id,
        ownerPersonId: branch.ownerPersonId,
        parentBranchId: branch.parentBranchId,
        childrenBranchIds: [...branch.childrenBranchIds].sort(),
        startNodeId: branch.startNodeId,
        endNodeId: branch.endNodeId,
        generation: branch.generation,
        genealogyDepth: branch.genealogyDepth,
        territoryId: branch.territoryId,
      })),
  );

const endpointSignature = (plan: SkeletonPlan): string =>
  canonicalJson(
    [...plan.branches]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((branch) => ({
        id: branch.id,
        p0: branch.curve.p0,
        p3: branch.curve.p3,
        startPoint: branch.startPoint,
        endPoint: branch.endPoint,
      })),
  );

const genealogyRelationshipSignature = (
  persons: readonly {
    readonly id: string;
    readonly parentId: string | null;
    readonly generation: number;
  }[],
): string =>
  canonicalJson(
    [...persons]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, parentId, generation }) => ({ id, parentId, generation })),
  );

const countLabelOverlaps = (layout: LabelLayoutResult): number => {
  const query = new LabelCollisionQuery();
  let count = 0;
  for (const placement of [...layout.placements].sort((left, right) =>
    left.placementId.localeCompare(right.placementId),
  )) {
    count += query.collisions(placement.bounds).filter(
      (collision) => collision.kind === "LABEL",
    ).length;
    query.addPlacement(placement);
  }
  return count;
};

const countWoodPenetrations = (
  layout: LabelLayoutResult,
  branches: readonly SkeletonBranch[],
): number => {
  const query = new LabelCollisionQuery({
    clearance: 0,
  });
  for (const obstacle of buildSkeletonWoodObstacles(
    branches,
    DEFAULT_ENGINE_CONFIGURATION.collision.barkAllowance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.bezierSubdivisionTolerance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.maxSubdivisionDepth,
  )) {
    query.addObstacle(obstacle);
  }
  return layout.placements.filter((placement) =>
    query.hasCollision(placement.bounds)
  ).length;
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");

const branchPath = (branch: SkeletonBranch): string =>
  `M ${format(branch.curve.p0.x)} ${format(branch.curve.p0.y)} ` +
  `C ${format(branch.curve.p1.x)} ${format(branch.curve.p1.y)} ` +
  `${format(branch.curve.p2.x)} ${format(branch.curve.p2.y)} ` +
  `${format(branch.curve.p3.x)} ${format(branch.curve.p3.y)}`;

const buildOverlay = (
  afterSvg: string,
  moved: ReturnType<typeof movedBranches>,
): string => {
  const overlays = moved.map((item) => {
    const width = Math.max(
      2,
      (item.after.thickness.baseThickness +
        item.after.thickness.tipThickness) / 2,
    );
    return [
      `<g class="relaxation-move" data-moved-branch-id="${escapeXml(item.after.id)}">`,
      `<path d="${branchPath(item.before)}" fill="none" stroke="#f97316" ` +
        `stroke-width="${format(width + 2)}" stroke-dasharray="10 7" opacity=".72"/>`,
      `<path d="${branchPath(item.after)}" fill="none" stroke="#db2777" ` +
        `stroke-width="${format(width + 2)}" opacity=".86"/>`,
      `<line x1="${format(item.before.curve.p1.x)}" y1="${format(item.before.curve.p1.y)}" ` +
        `x2="${format(item.after.curve.p1.x)}" y2="${format(item.after.curve.p1.y)}" ` +
        `stroke="#2563eb" stroke-width="1.5" opacity=".75"/>`,
      `<line x1="${format(item.before.curve.p2.x)}" y1="${format(item.before.curve.p2.y)}" ` +
        `x2="${format(item.after.curve.p2.x)}" y2="${format(item.after.curve.p2.y)}" ` +
        `stroke="#2563eb" stroke-width="1.5" opacity=".75"/>`,
      `</g>`,
    ].join("");
  }).join("\n");
  return afterSvg
    .replace(
      "Lubanda Golden Dataset — Visual Validation Preview",
      "Lubanda Golden Dataset — Local Relaxation Overlay",
    )
    .replace(
      `<g id="labels">`,
      `<g id="relaxation-overlay">${overlays}</g>\n<g id="labels">`,
    );
};

const sourceBytes = await timed("readWorkbook", () =>
  fs.readFile(workbookPath),
);
const sourceFileSha256Before = sha256Bytes(sourceBytes);
const imported = await timed("importWorkbook", () =>
  new XlsxGenealogyImporter().importWorkbook(
    sourceBytes.buffer.slice(
      sourceBytes.byteOffset,
      sourceBytes.byteOffset + sourceBytes.byteLength,
    ),
  ),
);
if (!imported.ok) {
  throw new Error(
    `Golden Dataset import failed: ${JSON.stringify(imported.errors)}`,
  );
}
const validation = await timed("validateGenealogy", async () =>
  new GenealogyValidator().validate(imported.value),
);
if (!validation.accepted) {
  throw new Error(
    `Golden Dataset validation failed: ${JSON.stringify(validation.issues)}`,
  );
}

const snapshot = buildAcceptedGenealogySnapshot(validation, {
  projectId: asProjectId("lubanda-golden-local-relaxation"),
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
  }),
);
const majorLineageIds = graph.childrenByParentId.get(selectedRootId) ?? [];
const demandById = new Map(
  demandPlan.results.map((item) => [item.personId, item] as const),
);
const requiredMajorArea = majorLineageIds.reduce(
  (total, id) =>
    total +
    Math.max(
      DEFAULT_ENGINE_CONFIGURATION.territory.minimumTerritoryArea,
      demandById.get(id)?.spatial.requiredArea ?? 0,
    ),
  0,
);
const territoryResult = await timed("territories", () =>
  new DeterministicTerritoryPlanner().plan({
    graph,
    demandPlan,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    templateBoundary: createTemplateBoundary(requiredMajorArea),
    configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
    seed,
  }),
);
if (!territoryResult.ok) {
  throw new Error(
    `Territory planning failed: ${JSON.stringify(territoryResult.errors)}`,
  );
}

const beforeSkeleton = await timed("growSkeleton", () =>
  new DeterministicSkeletonGrowthEngine().grow({
    graph,
    demandPlan,
    territoryPlan: territoryResult.value,
    selectedRootId,
    sourceChecksum: snapshot.sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
    seed,
  }),
);
if (beforeSkeleton.status !== "ACCEPTED") {
  throw new Error("Golden skeleton must be accepted");
}
const beforeLabels = await timed("placeLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: beforeSkeleton,
    templatePolygon: territoryResult.value.templatePolygon,
    configuration: DEFAULT_ENGINE_CONFIGURATION,
  }),
);
if (beforeLabels.status !== "ACCEPTED") {
  throw new Error(
    `Golden labels are incomplete: ${beforeLabels.metrics.unresolvedLabelCount}`,
  );
}

const relaxationInput = {
  graph,
  skeletonPlan: beforeSkeleton,
  territoryPlan: territoryResult.value,
  configuration: DEFAULT_ENGINE_CONFIGURATION,
  labelLayout: beforeLabels,
  relaxation: {
    maxIterations: 32,
    proposalBatchCount: 16,
    initialStepRatio: 0.025,
    stepDecay: 0.65,
    maximumControlPointMovement: 4,
    preserveLabelPlacements: true,
  },
};
const relaxed = await timed("relaxPrimary", () =>
  new BotanicalLocalRelaxationEngine().relax(relaxationInput),
);
const replay = await timed("relaxReplay", () =>
  new BotanicalLocalRelaxationEngine().relax(relaxationInput),
);
if (relaxed.status !== "RELAXED") {
  throw new Error(
    "Golden relaxation produced no accepted visual movement: " +
      JSON.stringify(relaxed.iterations),
  );
}

const afterSkeleton = relaxed.skeletonPlan;
const afterLabels = relaxed.labelLayout;
const beforePreview = await timed("beforeSvg", () =>
  new VisualPreviewExporter().export({
    graph,
    skeletonPlan: beforeSkeleton,
    labelLayout: beforeLabels,
    templatePolygon: territoryResult.value.templatePolygon,
  }),
);
const afterPreview = await timed("afterSvg", () =>
  new VisualPreviewExporter().export({
    graph,
    skeletonPlan: afterSkeleton,
    labelLayout: afterLabels,
    templatePolygon: territoryResult.value.templatePolygon,
  }),
);
const replayPreview = await timed("replaySvg", () =>
  new VisualPreviewExporter().export({
    graph,
    skeletonPlan: replay.skeletonPlan,
    labelLayout: replay.labelLayout,
    templatePolygon: territoryResult.value.templatePolygon,
  }),
);
const beforePng = await timed("beforePng", async () =>
  rasterizeSvg(beforePreview.svg),
);
const afterPng = await timed("afterPng", async () =>
  rasterizeSvg(afterPreview.svg),
);
const replayPng = await timed("replayPng", async () =>
  rasterizeSvg(replayPreview.svg),
);
const moved = movedBranches(beforeSkeleton, afterSkeleton);
const overlaySvg = await timed("overlaySvg", async () =>
  buildOverlay(afterPreview.svg, moved),
);

const displacements = moved.flatMap((item) => [
  item.p1Displacement,
  item.p2Displacement,
]);
const averageControlPointDisplacement = round(
  displacements.reduce((sum, value) => sum + value, 0) /
    Math.max(1, displacements.length),
);
const maximumDisplacement = round(Math.max(0, ...displacements));
const averageCurvatureBefore = averageCurvature(beforeSkeleton.branches);
const averageCurvatureAfter = averageCurvature(afterSkeleton.branches);
const territoryOccupancyBefore = territoryOccupancy(
  beforeSkeleton.branches,
  territoryResult.value.territories,
);
const territoryOccupancyAfter = territoryOccupancy(
  afterSkeleton.branches,
  territoryResult.value.territories,
);

const territoryPolygons = new Map(
  territoryResult.value.territories.map((territory) => [
    territory.id,
    territory.polygon,
  ]),
);
const finalValidation = await timed("validateAfterSkeleton", async () =>
  new SkeletonValidator().validate(
    afterSkeleton,
    graph,
    selectedRootId,
    territoryResult.value.templatePolygon,
    territoryPolygons,
  ),
);
const labelOverlaps = countLabelOverlaps(afterLabels);
const woodPenetrations = countWoodPenetrations(
  afterLabels,
  afterSkeleton.branches,
);

const sourceFileSha256After = sha256Bytes(await fs.readFile(workbookPath));
const labelsUnchanged =
  canonicalJson(beforeLabels.placements) ===
  canonicalJson(afterLabels.placements);
const topologyUnchanged =
  topologySignature(beforeSkeleton) === topologySignature(afterSkeleton);
const endpointsUnchanged =
  endpointSignature(beforeSkeleton) === endpointSignature(afterSkeleton);
const branchIdentitiesUnchanged =
  canonicalJson(beforeSkeleton.branches.map((branch) => branch.id).sort()) ===
  canonicalJson(afterSkeleton.branches.map((branch) => branch.id).sort());
const genealogyRelationshipsBefore =
  genealogyRelationshipSignature(snapshot.persons);
const genealogyRelationshipsAfter =
  genealogyRelationshipSignature(snapshot.persons);
const deterministicReplayMatched =
  relaxed.deterministicFingerprint === replay.deterministicFingerprint &&
  afterPreview.deterministicFingerprint ===
    replayPreview.deterministicFingerprint &&
  sha256Bytes(new TextEncoder().encode(afterPreview.svg)) ===
    sha256Bytes(new TextEncoder().encode(replayPreview.svg)) &&
  sha256Bytes(afterPng) === sha256Bytes(replayPng);

const deterministicFingerprint = await sha256Canonical({
  milestone: "BOTANICAL_LOCAL_RELAXATION_VISUAL_PROOF",
  sourceFileSha256Before,
  sourceSkeletonFingerprint: beforeSkeleton.deterministicFingerprint,
  relaxedSkeletonFingerprint: afterSkeleton.deterministicFingerprint,
  relaxationFingerprint: relaxed.deterministicFingerprint,
  labels: afterLabels.placements,
  metrics: {
    movedBranchIds: moved.map((item) => item.after.id),
    averageControlPointDisplacement,
    maximumDisplacement,
    averageCurvatureBefore,
    averageCurvatureAfter,
    territoryOccupancyBefore,
    territoryOccupancyAfter,
  },
});

const report = {
  schemaVersion: "1.0",
  milestone: "BOTANICAL_LOCAL_RELAXATION_VISUAL_PROOF",
  datasetMode: "GOLDEN_READ_ONLY",
  sourceFileName: path.basename(workbookPath),
  sourceFileSha256Before,
  sourceFileSha256After,
  sourceDatasetUnchanged: sourceFileSha256Before === sourceFileSha256After,
  totalPeople: validation.statistics.acceptedPersonCount,
  totalBranches: beforeSkeleton.branches.length,
  branchesMoved: moved.length,
  averageControlPointDisplacement,
  maximumDisplacement,
  averageCurvatureBefore,
  averageCurvatureAfter,
  curvatureUnit: "radians; mean per-branch maximum sampled turn",
  territoryOccupancyBefore,
  territoryOccupancyAfter,
  territoryOccupancyDefinition:
    "mean normalized proximity of each eligible branch midpoint to its assigned territory centroid",
  branchLengthDistributionBefore:
    beforePreview.metrics.branchLengthDistribution as BranchLengthDistribution,
  branchLengthDistributionAfter:
    afterPreview.metrics.branchLengthDistribution as BranchLengthDistribution,
  invariants: {
    genealogyUnchanged:
      genealogyRelationshipsBefore === genealogyRelationshipsAfter &&
      snapshot.sourceChecksum === imported.value.sourceChecksum,
    topologyUnchanged,
    parentChildRelationshipsUnchanged:
      genealogyRelationshipsBefore === genealogyRelationshipsAfter,
    branchIdentitiesUnchanged,
    endpointsUnchanged,
    labelsUnchanged,
    sourceSkeletonFingerprintPreserved:
      relaxed.sourceSkeletonFingerprint ===
      beforeSkeleton.deterministicFingerprint,
    deterministicFingerprintReplayUnchanged: deterministicReplayMatched,
  },
  validation: {
    afterSkeletonAccepted: finalValidation.accepted,
    branchIntersections: finalValidation.metrics.intersectionCount,
    outOfBoundsBranches: finalValidation.metrics.outOfBoundsCount,
    labelsPlaced: afterLabels.metrics.placedLabelCount,
    labelsUnresolved: afterLabels.metrics.unresolvedLabelCount,
    labelOverlaps,
    woodPenetrations,
  },
  artifacts: {
    beforeSvg: path.relative(process.cwd(), beforeSvgPath),
    afterSvg: path.relative(process.cwd(), afterSvgPath),
    beforePng: path.relative(process.cwd(), beforePngPath),
    afterPng: path.relative(process.cwd(), afterPngPath),
    overlaySvg: path.relative(process.cwd(), overlayPath),
    beforeSvgSha256: sha256Bytes(new TextEncoder().encode(beforePreview.svg)),
    afterSvgSha256: sha256Bytes(new TextEncoder().encode(afterPreview.svg)),
    beforePngSha256: sha256Bytes(beforePng),
    afterPngSha256: sha256Bytes(afterPng),
    overlaySvgSha256: sha256Bytes(new TextEncoder().encode(overlaySvg)),
  },
  relaxation: {
    status: relaxed.status,
    terminationReason: relaxed.terminationReason,
    acceptedIterations: relaxed.metrics.acceptedIterationCount,
    rejectedIterations: relaxed.metrics.rejectedIterationCount,
    meanTerritoryDistanceBefore:
      relaxed.metrics.meanTerritoryDistanceBefore,
    meanTerritoryDistanceAfter:
      relaxed.metrics.meanTerritoryDistanceAfter,
  },
  deterministicFingerprint,
  relaxationDeterministicFingerprint: relaxed.deterministicFingerprint,
  deterministicReplayFingerprint: replay.deterministicFingerprint,
  deterministicReplayMatched,
  totalRuntimeMilliseconds:
    Math.round((performance.now() - started) * 1_000) / 1_000,
  peakMemoryUsageBytes: process.resourceUsage().maxRSS * 1_024,
  stageRuntimesMilliseconds,
};

if (
  !report.sourceDatasetUnchanged ||
  report.branchesMoved === 0 ||
  report.territoryOccupancyAfter <= report.territoryOccupancyBefore ||
  beforePreview.svg === afterPreview.svg ||
  !Object.values(report.invariants).every(Boolean) ||
  !report.validation.afterSkeletonAccepted ||
  report.validation.branchIntersections !== 0 ||
  report.validation.outOfBoundsBranches !== 0 ||
  report.validation.labelsUnresolved !== 0 ||
  report.validation.labelOverlaps !== 0 ||
  report.validation.woodPenetrations !== 0 ||
  !report.deterministicReplayMatched
) {
  throw new Error(
    `Golden local relaxation E2E failed: ${JSON.stringify(report, null, 2)}`,
  );
}

await fs.mkdir(outputDirectory, { recursive: true });
await Promise.all([
  fs.writeFile(beforeSvgPath, beforePreview.svg, "utf8"),
  fs.writeFile(afterSvgPath, afterPreview.svg, "utf8"),
  fs.writeFile(beforePngPath, beforePng),
  fs.writeFile(afterPngPath, afterPng),
  fs.writeFile(overlayPath, overlaySvg, "utf8"),
  fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8"),
]);
console.log(reportPath);
