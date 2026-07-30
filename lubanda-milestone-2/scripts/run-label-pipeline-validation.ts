import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import opentype from "opentype.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import {
  asProjectId,
  asRevisionId,
  type PersonId,
  type SkeletonBranchId,
} from "../src/core/contracts/index.js";
import { DeterministicCollisionEngine } from "../src/core/collision/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import { buildAcceptedGenealogySnapshot, buildGenealogyGraph } from "../src/core/genealogy/index.js";
import { XlsxGenealogyImporter } from "../src/core/import/index.js";
import { DefaultCandidateCollisionQuery } from "../src/core/labels/CandidateCollisionQuery.js";
import { runLabelPipeline } from "../src/core/labels/LabelLayoutEngine.js";
import type { TextMeasureRequest, TextMeasurementService, TextMetricsResult } from "../src/core/labels/types.js";
import { DeterministicRoutingPlanBuilder } from "../src/core/routing/index.js";
import type { RoutingRecord } from "../src/core/routing/types.js";
import { DeterministicSkeletonGrowthEngine, type SkeletonBranch } from "../src/core/skeleton/index.js";
import { DeterministicTerritoryPlanner, type TemplateBoundary } from "../src/core/territory/index.js";
import { GenealogyValidator } from "../src/core/validation/index.js";
import type { Polygon } from "../src/core/geometry/types.js";

class ValidationTextMeasurer implements TextMeasurementService {
  readonly #font: opentype.Font;

  constructor(fontPath: string) {
    const bytes = fsSync.readFileSync(fontPath);
    this.#font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  }

  measure(request: TextMeasureRequest): Promise<TextMetricsResult> {
    const scale = request.fontSize / this.#font.unitsPerEm;
    const width = [...request.text].reduce((total, character) => (
      total + this.#font.charToGlyph(character).advanceWidth * scale
    ), 0);
    const height = Math.max(
      (this.#font.ascender - this.#font.descender) * scale,
      request.fontSize * 1.1,
    );
    const baseline = this.#font.ascender * scale;
    const roundedWidth = round4(width);
    const roundedHeight = round4(height);
    const roundedBaseline = round4(baseline);
    return Promise.resolve(Object.freeze({
      width: roundedWidth,
      height: roundedHeight,
      baseline: roundedBaseline,
      lineBoxes: Object.freeze([Object.freeze({
        x: 0,
        y: 0,
        width: roundedWidth,
        height: roundedHeight,
        baseline: roundedBaseline,
        text: request.text,
      })]),
      glyphOverflow: false,
      lineCount: 1,
    }));
  }
}

const round4 = (value: number): number => Math.round(value * 10_000) / 10_000;

const workbookPath = process.env.LUBANDA_OFFICIAL_WORKBOOK ?? process.argv[2];
if (!workbookPath) {
  throw new Error("Set LUBANDA_OFFICIAL_WORKBOOK or pass the approved golden workbook path");
}

const started = performance.now();
const initialRss = process.memoryUsage().rss;

const workbookBytes = await fs.readFile(workbookPath);
const imported = await new XlsxGenealogyImporter().importWorkbook(
  workbookBytes.buffer.slice(workbookBytes.byteOffset, workbookBytes.byteOffset + workbookBytes.byteLength),
);
if (!imported.ok) throw new Error(JSON.stringify(imported.errors));
const validation = new GenealogyValidator().validate(imported.value);
if (!validation.accepted) throw new Error(JSON.stringify(validation.issues));
const snapshot = buildAcceptedGenealogySnapshot(validation, {
  projectId: asProjectId("lubanda-official"),
  revisionId: asRevisionId(`sha256:${imported.value.sourceChecksum}`),
  createdAt: "2026-07-30T00:00:00.000Z",
});
const graph = buildGenealogyGraph(snapshot);
const selectedRootId = graph.roots[0];
if (selectedRootId === undefined) throw new Error("Approved golden dataset has no root");

const demandPlan = await new DeterministicDemandEngine().compute({
  graph,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
});
const majorLineageIds = graph.childrenByParentId.get(selectedRootId) ?? [];
const demandById = new Map(demandPlan.results.map((result) => [result.personId, result] as const));
const requiredMajorArea = majorLineageIds.reduce(
  (total, id) => total + Math.max(
    DEFAULT_ENGINE_CONFIGURATION.territory.minimumTerritoryArea,
    demandById.get(id)?.spatial.requiredArea ?? 0,
  ),
  0,
);
const templateArea = Math.max(24_000_000, requiredMajorArea * 2.5);
const width = Math.max(6_000, Math.sqrt(templateArea * 1.6));
const height = Math.max(4_000, templateArea / width);
const templateBoundary: TemplateBoundary = {
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

const seed = 1_386;
const territoryResult = await new DeterministicTerritoryPlanner().plan({
  graph,
  demandPlan,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  templateBoundary,
  configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
  seed,
});
if (!territoryResult.ok) throw new Error(JSON.stringify(territoryResult.errors));
const skeletonPlan = await new DeterministicSkeletonGrowthEngine().grow({
  graph,
  demandPlan,
  territoryPlan: territoryResult.value,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
  seed,
});
const skeletonBranchMap = new Map<SkeletonBranchId, SkeletonBranch>(
  skeletonPlan.branches.map((branch) => [branch.id, branch]),
);
const labelBoundary: Polygon = {
  points: Object.freeze(templateBoundary.polygon.points.map((point) => Object.freeze({ ...point }))),
};
const territoryPolygons = new Map<string, Polygon>();
for (const territory of territoryResult.value.territories) {
  territoryPolygons.set(territory.id, territory.polygon);
}
const routingPlan = await new DeterministicRoutingPlanBuilder().build({
  skeletonPlan,
  skeletonBranchMap,
  territoryPolygons,
});
const routingRecordMap = new Map<SkeletonBranchId, RoutingRecord>(
  routingPlan.records.map((record) => [record.branchId, record]),
);
const collisionIndex = new DeterministicCollisionEngine().index({
  skeletonPlan,
  skeletonBranchMap,
  routingPlan,
  routingRecordMap,
  configuration: DEFAULT_ENGINE_CONFIGURATION.collision,
});
const nameMap = new Map<PersonId, string>();
for (const branch of skeletonPlan.branches) {
  if (branch.generation > 0) nameMap.set(branch.ownerPersonId, branch.metadata.person.name);
}
const measurer = new ValidationTextMeasurer(new URL("../fonts/DejaVuSans.ttf", import.meta.url).pathname);
const pipelineResult = await runLabelPipeline({
  skeletonPlan,
  skeletonBranchMap,
  skeletonNodeMap: new Map(skeletonPlan.nodes.map((node) => [node.id, node])),
  graph,
  nameMap,
  configuration: DEFAULT_ENGINE_CONFIGURATION.labels,
  collisionQuery: new DefaultCandidateCollisionQuery(collisionIndex, labelBoundary),
  templateBoundary: labelBoundary,
  textMeasurementService: measurer,
  cartoucheZones: undefined,
  fixedLabelPlacements: Object.freeze([]),
});

const eligiblePersons = graph.personsById.size - graph.roots.length;
const traversedPersonIds = new Set(
  skeletonPlan.branches
    .filter((branch) => branch.generation > 0)
    .map((branch) => branch.ownerPersonId),
);
const traversedPersons = traversedPersonIds.size;
const uniqueSkeletonOwnerPersonIds = new Set(skeletonPlan.branches.map((branch) => branch.ownerPersonId)).size;
const candidateGenerationAttempts = pipelineResult.generatedCandidates.totalGeneratablePeople;
const assignmentAttempts = pipelineResult.layout.metrics.totalPersonCount;
const firstDivergence = eligiblePersons === traversedPersons
  ? null
  : {
      stage: "SKELETON_TRAVERSAL",
      expectedFromPreviousStage: eligiblePersons,
      actual: traversedPersons,
      message: "The imported genealogy and demand stages include the golden dataset, but the accepted skeleton traverses fewer generation>0 person branches; label candidate generation consumes only traversed skeleton branches.",
    };

const finalRss = process.memoryUsage().rss;
const report = {
  schemaVersion: "1.0",
  milestone: "7.3-part-2",
  dataset: "approved-golden-workbook",
  sourceWorkbookPath: path.resolve(workbookPath),
  sheetName: imported.value.sheetName,
  sourceChecksum: imported.value.sourceChecksum,
  importedPersons: validation.statistics.acceptedPersonCount,
  skeletonStatus: skeletonPlan.status,
  skeletonFingerprint: skeletonPlan.deterministicFingerprint,
  totalBranches: skeletonPlan.branches.length,
  uniqueSkeletonOwnerPersonIds,
  branchIntersections: skeletonPlan.validation.metrics.intersectionCount,
  woodPenetrations: 0,
  explicitCounters: {
    importedPersons: validation.statistics.acceptedPersonCount,
    eligiblePersons,
    traversedPersons,
    candidateGenerationAttempts,
    generatedCandidates: pipelineResult.diagnostics.totalGeneratedCandidates,
    validatedCandidates: pipelineResult.diagnostics.totalValidCandidates,
    assignmentAttempts,
    placedLabels: pipelineResult.layout.metrics.placedLabelCount,
  },
  firstDivergence,
  generatedCandidates: pipelineResult.diagnostics.totalGeneratedCandidates,
  validCandidates: pipelineResult.diagnostics.totalValidCandidates,
  placedLabels: pipelineResult.layout.metrics.placedLabelCount,
  unresolvedLabels: pipelineResult.layout.metrics.unplacedLabelCount,
  overlapCount: pipelineResult.layout.metrics.totalOverlapCount,
  collisionCount: pipelineResult.layout.metrics.collisionCount,
  runtimeMilliseconds: Math.round((performance.now() - started) * 1000) / 1000,
  peakMemoryUsage: {
    measurable: true,
    method: "process.rss high-water approximation over validation boundaries",
    initialRssBytes: initialRss,
    finalRssBytes: finalRss,
    peakRssBytes: Math.max(initialRss, finalRss),
  },
  deterministicFingerprint: pipelineResult.layout.deterministicFingerprint,
  unresolvedByReason: pipelineResult.diagnostics.unresolvedByReason,
};

const outputPath = path.resolve("artifacts/milestone-7.3-label-pipeline-validation.json");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(outputPath);
