import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  asProjectId,
  asRevisionId,
  type EngineIssue,
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
import { DeterministicSkeletonGrowthEngine } from "../src/core/skeleton/index.js";
import { SkeletonValidator } from "../src/core/layout/SkeletonValidator.js";
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

const outputPath = path.resolve(
  process.env.LUBANDA_GOLDEN_REPORT ??
    "artifacts/golden-dataset-validation-report.json",
);
const seed = 1_386;
const started = performance.now();
const stageRuntimesMilliseconds: Record<string, number> = {};

const timed = async <T>(name: string, operation: () => Promise<T>): Promise<T> => {
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

const countIssues = (
  issues: readonly EngineIssue[],
  code: EngineIssue["code"],
): number => issues.filter((issue) => issue.code === code).length;

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
): { readonly labels: number; readonly collisionPairs: number } => {
  const obstacles = buildSkeletonWoodObstacles(
    branches,
    DEFAULT_ENGINE_CONFIGURATION.collision.barkAllowance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.bezierSubdivisionTolerance,
    DEFAULT_ENGINE_CONFIGURATION.geometry.maxSubdivisionDepth,
  );
  const query = new LabelCollisionQuery();
  for (const obstacle of obstacles) query.addObstacle(obstacle);

  let labels = 0;
  let collisionPairs = 0;
  for (const placement of layout.placements) {
    const collisions = query.collisions(placement.bounds).filter(
      (collision) => collision.kind === "WOOD",
    );
    if (collisions.length > 0) labels += 1;
    collisionPairs += collisions.length;
  }
  return { labels, collisionPairs };
};

const initialBytes = await timed("readWorkbook", () => fs.readFile(workbookPath));
const sourceFileSha256Before = sha256Bytes(initialBytes);
const imported = await timed("importWorkbook", () =>
  new XlsxGenealogyImporter().importWorkbook(
    initialBytes.buffer.slice(
      initialBytes.byteOffset,
      initialBytes.byteOffset + initialBytes.byteLength,
    ),
  ),
);

if (!imported.ok) {
  throw new Error(`Golden Dataset import failed: ${JSON.stringify(imported.errors)}`);
}

const validation = await timed("validateGenealogy", async () =>
  new GenealogyValidator().validate(imported.value),
);
const reportBase = {
  schemaVersion: "1.0",
  datasetMode: "GOLDEN_READ_ONLY",
  sourceFileName: path.basename(workbookPath),
  sourceFileSha256Before,
  normalizedSourceChecksum: imported.value.sourceChecksum,
  totalPeopleImported: imported.value.normalizedRows.length,
  importedSuccessfully: validation.statistics.acceptedPersonCount,
  importAccepted: validation.accepted,
  missingParentReferences: countIssues(validation.issues, "MISSING_PARENT"),
  duplicateIds: countIssues(validation.issues, "DUPLICATE_ID"),
  generationMismatches: countIssues(validation.issues, "GENERATION_MISMATCH"),
};

if (!validation.accepted) {
  const finalBytes = await fs.readFile(workbookPath);
  const sourceFileSha256After = sha256Bytes(finalBytes);
  const report = {
    ...reportBase,
    labelsPlaced: null,
    labelsUnresolved: null,
    branchIntersections: null,
    labelOverlaps: null,
    woodPenetrations: null,
    deterministicFingerprint: null,
    deterministicReplayMatched: null,
    totalRuntimeMilliseconds:
      Math.round((performance.now() - started) * 1_000) / 1_000,
    peakMemoryUsageBytes: process.resourceUsage().maxRSS * 1_024,
    stageRuntimesMilliseconds,
    sourceFileSha256After,
    datasetUnmodified: sourceFileSha256Before === sourceFileSha256After,
    issues: validation.issues,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(outputPath);
  process.exitCode = 2;
} else {
  const snapshot = buildAcceptedGenealogySnapshot(validation, {
    projectId: asProjectId("lubanda-golden"),
    revisionId: asRevisionId(`sha256:${imported.value.sourceChecksum}`),
    createdAt: "2026-07-29T00:00:00.000Z",
  });
  const graph = buildGenealogyGraph(snapshot);
  const selectedRootId = graph.roots[0];
  if (!selectedRootId) throw new Error("Golden Dataset has no root");

  const runPipeline = async (stagePrefix: string) => {
    const demandPlan = await timed(`${stagePrefix}Demand`, () =>
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
      throw new Error(`Territory planning failed: ${JSON.stringify(territoryResult.errors)}`);
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
    const independentSkeletonValidation = await timed(
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
    const labelLayout = skeletonPlan.status === "ACCEPTED"
      ? await timed(`${stagePrefix}Labels`, async () =>
          new LabelLayoutEngine().layout({
            graph,
            skeletonPlan,
            templatePolygon: territoryResult.value.templatePolygon,
            configuration: DEFAULT_ENGINE_CONFIGURATION,
          }),
        )
      : null;
    const deterministicFingerprint = await timed(
      `${stagePrefix}Fingerprint`,
      () =>
        sha256Canonical({
          sourceChecksum: snapshot.sourceChecksum,
          demandFingerprint: demandPlan.computationMetadata.deterministicFingerprint,
          territoryFingerprint: territoryResult.value.deterministicFingerprint,
          skeletonFingerprint: skeletonPlan.deterministicFingerprint,
          skeletonStatus: skeletonPlan.status,
          skeletonValidation: independentSkeletonValidation,
          labels: labelLayout === null
            ? null
            : {
                status: labelLayout.status,
                placements: labelLayout.placements,
                unresolvedPersonIds: labelLayout.unresolvedPersonIds,
              },
        }),
    );
    return {
      skeletonPlan,
      independentSkeletonValidation,
      labelLayout,
      deterministicFingerprint,
    };
  };

  const first = await runPipeline("primary");
  const labelOverlaps = first.labelLayout === null
    ? null
    : await timed("validateLabelOverlaps", async () =>
        countLabelOverlaps(first.labelLayout as LabelLayoutResult),
      );
  const woodPenetrationResult = first.labelLayout === null
    ? null
    : await timed("validateWoodPenetrations", async () =>
        countWoodPenetrations(
          first.labelLayout as LabelLayoutResult,
          first.skeletonPlan.branches,
        ),
      );
  const replay = await runPipeline("replay");
  const sourceFileSha256After = sha256Bytes(await fs.readFile(workbookPath));
  const report = {
    ...reportBase,
    pipelineStatus:
      first.skeletonPlan.status === "ACCEPTED"
        ? "COMPLETED"
        : "BLOCKED_AT_SKELETON_GROWTH",
    skeletonStatus: first.skeletonPlan.status,
    skeletonPeoplePlaced:
      new Set(first.skeletonPlan.branches.map((branch) => branch.ownerPersonId)).size,
    skeletonPeopleMissing:
      first.independentSkeletonValidation.metrics.missingPersonBranchCount,
    skeletonBlockingIssues: first.skeletonPlan.validation.issues,
    finalSkeletonDiagnostics: first.skeletonPlan.diagnostics.slice(-5),
    labelsPlaced: first.labelLayout?.metrics.placedLabelCount ?? 0,
    labelsUnresolved:
      first.labelLayout?.metrics.unresolvedLabelCount ??
      validation.statistics.acceptedPersonCount,
    labelStageStatus:
      first.labelLayout === null ? "NOT_RUN_UPSTREAM_SKELETON_REJECTED" : first.labelLayout.status,
    branchIntersections:
      first.independentSkeletonValidation.metrics.intersectionCount,
    labelOverlaps,
    woodPenetrations: woodPenetrationResult?.labels ?? null,
    woodPenetrationCollisionPairs:
      woodPenetrationResult?.collisionPairs ?? null,
    deterministicFingerprint: first.deterministicFingerprint,
    deterministicReplayFingerprint: replay.deterministicFingerprint,
    deterministicReplayMatched:
      first.deterministicFingerprint === replay.deterministicFingerprint,
    totalRuntimeMilliseconds:
      Math.round((performance.now() - started) * 1_000) / 1_000,
    peakMemoryUsageBytes: process.resourceUsage().maxRSS * 1_024,
    stageRuntimesMilliseconds,
    sourceFileSha256After,
    datasetUnmodified: sourceFileSha256Before === sourceFileSha256After,
  };
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(outputPath);
  if (
    !report.deterministicReplayMatched ||
    !report.datasetUnmodified ||
    report.branchIntersections > 0 ||
    (report.labelOverlaps ?? 0) > 0 ||
    (report.woodPenetrations ?? 0) > 0 ||
    report.pipelineStatus !== "COMPLETED"
  ) {
    process.exitCode = 3;
  }
}
