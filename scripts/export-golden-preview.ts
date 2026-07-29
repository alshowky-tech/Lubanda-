import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Resvg } from "@resvg/resvg-js";
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
import { XlsxGenealogyImporter } from "../src/core/import/index.js";
import {
  buildSkeletonWoodObstacles,
  LabelCollisionQuery,
  LabelLayoutEngine,
  type LabelLayoutResult,
} from "../src/core/labels/index.js";
import { SkeletonValidator } from "../src/core/layout/SkeletonValidator.js";
import { VisualPreviewExporter } from "../src/core/preview/index.js";
import { DeterministicSkeletonGrowthEngine } from "../src/core/skeleton/index.js";
import {
  DeterministicTerritoryPlanner,
  type TemplateBoundary,
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
  process.env.LUBANDA_PREVIEW_OUTPUT_DIR ?? "artifacts",
);
const svgPath = path.join(
  outputDirectory,
  "golden-full-tree-preview.svg",
);
const pngPath = path.join(
  outputDirectory,
  "golden-full-tree-preview.png",
);
const reportPath = path.join(
  outputDirectory,
  "golden-visual-validation-report.json",
);
const displayNameComparisonReportPath = path.join(
  outputDirectory,
  "golden-display-name-comparison-report.json",
);
const seed = 1_386;
const PNG_WIDTH = 4_096;
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

const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

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

const countLabelOverlaps = (layout: LabelLayoutResult): number => {
  const query = new LabelCollisionQuery();
  let overlapPairs = 0;
  for (const placement of [...layout.placements].sort((left, right) =>
    left.placementId.localeCompare(right.placementId),
  )) {
    overlapPairs += query.collisions(placement.bounds).filter(
      (collision) => collision.kind === "LABEL",
    ).length;
    query.addPlacement(placement);
  }
  return overlapPairs;
};

const countWoodPenetrations = (
  layout: LabelLayoutResult,
  branches: Parameters<typeof buildSkeletonWoodObstacles>[0],
): number => {
  const obstacles = buildSkeletonWoodObstacles(
    branches,
    DEFAULT_ENGINE_CONFIGURATION.collision.barkAllowance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.bezierSubdivisionTolerance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.maxSubdivisionDepth,
  );
  const query = new LabelCollisionQuery();
  for (const obstacle of obstacles) query.addObstacle(obstacle);
  return layout.placements.filter((placement) =>
    query.collisions(placement.bounds).some(
      (collision) => collision.kind === "WOOD",
    ),
  ).length;
};

const rasterizeSvg = (svg: string): Uint8Array => {
  const renderer = new Resvg(svg, {
    background: "#ffffff",
    fitTo: {
      mode: "width",
      value: PNG_WIDTH,
    },
    font: {
      defaultFontFamily: "DejaVu Sans",
      loadSystemFonts: true,
    },
  });
  return renderer.render().asPng();
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
  projectId: asProjectId("lubanda-golden-visual-preview"),
  revisionId: asRevisionId(`sha256:${imported.value.sourceChecksum}`),
  createdAt: "2026-07-29T00:00:00.000Z",
});
const graph = buildGenealogyGraph(snapshot);
const selectedRootId = graph.roots[0];
if (selectedRootId === undefined) {
  throw new Error("Golden Dataset has no root");
}

const runPipeline = async (stagePrefix: string) => {
  const demandPlan = await timed(`${stagePrefix}Demand`, () =>
    new DeterministicDemandEngine().compute({
      graph,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
    }),
  );
  const majorLineageIds =
    graph.childrenByParentId.get(selectedRootId) ?? [];
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
  const templateBoundary = createTemplateBoundary(requiredMajorArea);
  const territoryResult = await timed(`${stagePrefix}Territories`, () =>
    new DeterministicTerritoryPlanner().plan({
      graph,
      demandPlan,
      selectedRootId,
      sourceChecksum: snapshot.sourceChecksum,
      templateBoundary,
      configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
      seed,
    }),
  );
  if (!territoryResult.ok) {
    throw new Error(
      `Territory planning failed: ${JSON.stringify(territoryResult.errors)}`,
    );
  }
  const skeletonPlan = await timed(`${stagePrefix}Skeleton`, () =>
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
  const skeletonValidation = await timed(
    `${stagePrefix}ValidateSkeleton`,
    async () =>
      new SkeletonValidator().validate(
        skeletonPlan,
        graph,
        selectedRootId,
        territoryResult.value.templatePolygon,
        new Map(
          territoryResult.value.territories.map((territory) => [
            territory.id,
            territory.polygon,
          ]),
        ),
      ),
  );
  if (skeletonPlan.status !== "ACCEPTED") {
    throw new Error("Golden Skeleton must be accepted before preview export");
  }
  const labelLayout = await timed(`${stagePrefix}Labels`, async () =>
    new LabelLayoutEngine().layout({
      graph,
      skeletonPlan,
      templatePolygon: territoryResult.value.templatePolygon,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    }),
  );
  if (labelLayout.status !== "ACCEPTED") {
    throw new Error(
      `Golden labels are incomplete: ${labelLayout.metrics.unresolvedLabelCount}`,
    );
  }
  const preview = await timed(`${stagePrefix}BuildSvg`, () =>
    new VisualPreviewExporter().export({
      graph,
      skeletonPlan,
      labelLayout,
      templatePolygon: territoryResult.value.templatePolygon,
    }),
  );
  const png = await timed(`${stagePrefix}RasterizePng`, async () =>
    rasterizeSvg(preview.svg),
  );
  const pipelineFingerprint = await timed(
    `${stagePrefix}Fingerprint`,
    () =>
      sha256Canonical({
        sourceChecksum: snapshot.sourceChecksum,
        demandFingerprint:
          demandPlan.computationMetadata.deterministicFingerprint,
        territoryFingerprint:
          territoryResult.value.deterministicFingerprint,
        skeletonFingerprint: skeletonPlan.deterministicFingerprint,
        labels: labelLayout.placements,
        visualFingerprint: preview.deterministicFingerprint,
      }),
  );
  return {
    skeletonPlan,
    skeletonValidation,
    labelLayout,
    preview,
    png,
    pipelineFingerprint,
    templatePolygon: territoryResult.value.templatePolygon,
  };
};

const primary = await runPipeline("primary");
const unformattedConfiguration = {
  ...DEFAULT_ENGINE_CONFIGURATION,
  displayNames: {
    ...DEFAULT_ENGINE_CONFIGURATION.displayNames,
    removeHonorificPrefixes: false,
  },
};
const unformattedLabelLayout = await timed("comparisonUnformattedLabels", async () =>
  new LabelLayoutEngine().layout({
    graph,
    skeletonPlan: primary.skeletonPlan,
    templatePolygon: primary.templatePolygon,
    configuration: unformattedConfiguration,
  }),
);
if (unformattedLabelLayout.status !== "ACCEPTED") {
  throw new Error(
    "Unformatted comparison labels must remain complete: " +
      unformattedLabelLayout.metrics.unresolvedLabelCount,
  );
}
const unformattedPreview = await timed("comparisonUnformattedPreview", () =>
  new VisualPreviewExporter().export({
    graph,
    skeletonPlan: primary.skeletonPlan,
    labelLayout: unformattedLabelLayout,
    templatePolygon: primary.templatePolygon,
  }),
);
const labelOverlaps = await timed("validateLabelOverlaps", async () =>
  countLabelOverlaps(primary.labelLayout),
);
const woodPenetrations = await timed(
  "validateWoodPenetrations",
  async () =>
    countWoodPenetrations(
      primary.labelLayout,
      primary.skeletonPlan.branches,
    ),
);
const replay = await runPipeline("replay");
const primarySvgBytes = new TextEncoder().encode(primary.preview.svg);
const replaySvgBytes = new TextEncoder().encode(replay.preview.svg);
const svgSha256 = sha256Bytes(primarySvgBytes);
const replaySvgSha256 = sha256Bytes(replaySvgBytes);
const pngSha256 = sha256Bytes(primary.png);
const replayPngSha256 = sha256Bytes(replay.png);
const sourceFileSha256After = sha256Bytes(await fs.readFile(workbookPath));
const deterministicReplayMatched =
  primary.pipelineFingerprint === replay.pipelineFingerprint &&
  primary.preview.deterministicFingerprint ===
    replay.preview.deterministicFingerprint &&
  svgSha256 === replaySvgSha256 &&
  pngSha256 === replayPngSha256;

const placementWidths = (layout: LabelLayoutResult): readonly number[] =>
  layout.placements.map((placement) =>
    placement.bounds.maxX - placement.bounds.minX
  );
const average = (values: readonly number[]): number =>
  values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
const roundMetric = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
const beforeWidths = placementWidths(unformattedLabelLayout);
const afterWidths = placementWidths(primary.labelLayout);
const averageLabelWidthBefore = average(beforeWidths);
const averageLabelWidthAfter = average(afterWidths);
const maximumLabelWidthBefore = Math.max(0, ...beforeWidths);
const maximumLabelWidthAfter = Math.max(0, ...afterWidths);
const beforeLabelSpan = unformattedPreview.metrics.labelBounds === null
  ? 0
  : unformattedPreview.metrics.labelBounds.maxX -
    unformattedPreview.metrics.labelBounds.minX;
const afterLabelSpan = primary.preview.metrics.labelBounds === null
  ? 0
  : primary.preview.metrics.labelBounds.maxX -
    primary.preview.metrics.labelBounds.minX;
const collisionRejectionsBefore =
  unformattedLabelLayout.metrics.collisionRejectedCandidateCount;
const collisionRejectionsAfter =
  primary.labelLayout.metrics.collisionRejectedCandidateCount;
const formattedNamesByPerson = new Map(
  primary.labelLayout.placements.map((placement) => [
    placement.personId,
    placement.displayName,
  ]),
);
const formattedLabelCount = unformattedLabelLayout.placements.filter(
  (placement) =>
    formattedNamesByPerson.get(placement.personId) !== placement.displayName,
).length;

const report = {
  schemaVersion: "1.0",
  milestone: "VISUAL_VALIDATION_AND_PREVIEW_EXPORT",
  datasetMode: "GOLDEN_READ_ONLY",
  sourceFileName: path.basename(workbookPath),
  sourceFileSha256Before,
  sourceFileSha256After,
  datasetUnmodified: sourceFileSha256Before === sourceFileSha256After,
  totalPeopleImported: validation.statistics.acceptedPersonCount,
  skeletonCoverage: primary.preview.metrics.skeletonCoverage,
  labelsPlaced: primary.preview.metrics.labelCoverage,
  labelsUnresolved: primary.labelLayout.metrics.unresolvedLabelCount,
  branchCount: primary.preview.metrics.branchCount,
  trunkBranchCount: primary.preview.metrics.trunkBranchCount,
  organicCandidateBranchCount:
    primary.preview.metrics.organicBranchCount,
  recoveryGeneratedBranchCount:
    primary.preview.metrics.recoveryBranchCount,
  branchAttachedLabelCount:
    primary.preview.metrics.branchAttachedLabelCount,
  fallbackLaneLabelCount:
    primary.preview.metrics.fallbackLaneLabelCount,
  branchIntersections:
    primary.skeletonValidation.metrics.intersectionCount,
  labelOverlaps,
  woodPenetrations,
  minimumLabelFontSize:
    primary.preview.metrics.minimumLabelFontSize,
  skeletonBounds: primary.preview.metrics.skeletonBounds,
  labelBounds: primary.preview.metrics.labelBounds,
  treeBounds: primary.preview.metrics.treeBounds,
  labelArea: primary.preview.metrics.labelArea,
  labelDensity: primary.preview.metrics.labelDensity,
  branchLengthDistribution:
    primary.preview.metrics.branchLengthDistribution,
  artifacts: {
    svg: path.relative(process.cwd(), svgPath),
    png: path.relative(process.cwd(), pngPath),
    pngWidth: PNG_WIDTH,
    svgSha256,
    pngSha256,
  },
  deterministicFingerprint: primary.pipelineFingerprint,
  deterministicReplayFingerprint: replay.pipelineFingerprint,
  visualDeterministicFingerprint:
    primary.preview.deterministicFingerprint,
  visualReplayFingerprint:
    replay.preview.deterministicFingerprint,
  replaySvgSha256,
  replayPngSha256,
  deterministicReplayMatched,
  totalRuntimeMilliseconds:
    Math.round((performance.now() - started) * 1_000) / 1_000,
  peakMemoryUsageBytes: process.resourceUsage().maxRSS * 1_024,
  stageRuntimesMilliseconds,
};

const displayNameComparisonReport = {
  schemaVersion: "1.0",
  milestone: "CONFIGURABLE_DISPLAY_NAME_FORMATTER",
  datasetMode: "GOLDEN_READ_ONLY",
  sourceFileName: path.basename(workbookPath),
  sourceFileSha256Before,
  sourceFileSha256After,
  datasetUnmodified: sourceFileSha256Before === sourceFileSha256After,
  totalPeople: validation.statistics.acceptedPersonCount,
  formattedLabelCount,
  labelsPlacedBefore: unformattedLabelLayout.metrics.placedLabelCount,
  labelsPlacedAfter: primary.labelLayout.metrics.placedLabelCount,
  labelsUnresolvedBefore: unformattedLabelLayout.metrics.unresolvedLabelCount,
  labelsUnresolvedAfter: primary.labelLayout.metrics.unresolvedLabelCount,
  averageLabelWidthBefore: roundMetric(averageLabelWidthBefore),
  averageLabelWidthAfter: roundMetric(averageLabelWidthAfter),
  averageLabelWidthReduction: roundMetric(
    averageLabelWidthBefore - averageLabelWidthAfter,
  ),
  averageLabelWidthReductionPercent: roundMetric(
    averageLabelWidthBefore === 0
      ? 0
      : (averageLabelWidthBefore - averageLabelWidthAfter) /
        averageLabelWidthBefore * 100,
  ),
  maximumLabelWidthBefore: roundMetric(maximumLabelWidthBefore),
  maximumLabelWidthAfter: roundMetric(maximumLabelWidthAfter),
  maximumLabelWidthReduction: roundMetric(
    maximumLabelWidthBefore - maximumLabelWidthAfter,
  ),
  estimatedSvgWidthReduction: {
    basis: "horizontal label-bounds span; template and skeleton geometry unchanged",
    before: roundMetric(beforeLabelSpan),
    after: roundMetric(afterLabelSpan),
    absolute: roundMetric(Math.max(0, beforeLabelSpan - afterLabelSpan)),
    percent: roundMetric(
      beforeLabelSpan === 0
        ? 0
        : Math.max(0, beforeLabelSpan - afterLabelSpan) / beforeLabelSpan * 100,
    ),
  },
  estimatedCollisionReduction: {
    basis: "label-layout collision-rejected candidate count",
    before: collisionRejectionsBefore,
    after: collisionRejectionsAfter,
    absolute: collisionRejectionsBefore - collisionRejectionsAfter,
    percent: roundMetric(
      collisionRejectionsBefore === 0
        ? 0
        : (collisionRejectionsBefore - collisionRejectionsAfter) /
          collisionRejectionsBefore * 100,
    ),
  },
  deterministicFingerprint: primary.pipelineFingerprint,
  deterministicReplayFingerprint: replay.pipelineFingerprint,
  deterministicReplayMatched,
};

if (
  !report.datasetUnmodified ||
  !report.deterministicReplayMatched ||
  report.skeletonCoverage !== validation.statistics.acceptedPersonCount ||
  report.labelsPlaced !== validation.statistics.acceptedPersonCount ||
  report.labelsUnresolved !== 0 ||
  report.branchIntersections !== 0 ||
  report.labelOverlaps !== 0 ||
  report.woodPenetrations !== 0
) {
  throw new Error(
    `Visual validation failed: ${JSON.stringify(report, null, 2)}`,
  );
}

await fs.mkdir(outputDirectory, { recursive: true });
await fs.writeFile(svgPath, primary.preview.svg, "utf8");
await fs.writeFile(pngPath, primary.png);
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(
  displayNameComparisonReportPath,
  `${JSON.stringify(displayNameComparisonReport, null, 2)}\n`,
);
console.log(reportPath);
console.log(displayNameComparisonReportPath);
