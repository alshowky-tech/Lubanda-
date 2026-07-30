import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { performance } from "node:perf_hooks";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import {
  asPersonId,
  asProjectId,
  asRevisionId,
  type PersonId,
  type SkeletonBranchId,
} from "../src/core/contracts/index.js";
import { DeterministicCollisionEngine } from "../src/core/collision/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import { buildGenealogyGraph } from "../src/core/genealogy/index.js";
import type { GenealogySnapshot } from "../src/core/genealogy/types.js";
import { DefaultCandidateCollisionQuery } from "../src/core/labels/CandidateCollisionQuery.js";
import { runLabelPipeline } from "../src/core/labels/LabelLayoutEngine.js";
import type { TextMeasureRequest, TextMeasurementService, TextMetricsResult } from "../src/core/labels/types.js";
import { DeterministicRoutingPlanBuilder } from "../src/core/routing/index.js";
import type { RoutingRecord } from "../src/core/routing/types.js";
import { DeterministicSkeletonGrowthEngine, type SkeletonBranch } from "../src/core/skeleton/index.js";
import { DeterministicTerritoryPlanner, type TemplateBoundary } from "../src/core/territory/index.js";
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
    const roundedWidth = Math.round(width * 10_000) / 10_000;
    const roundedHeight = Math.round(height * 10_000) / 10_000;
    return Promise.resolve(Object.freeze({
      width: roundedWidth,
      height: roundedHeight,
      baseline: Math.round(this.#font.ascender * scale * 10_000) / 10_000,
      lineBoxes: Object.freeze([Object.freeze({
        x: 0,
        y: 0,
        width: roundedWidth,
        height: roundedHeight,
        baseline: Math.round(this.#font.ascender * scale * 10_000) / 10_000,
        text: request.text,
      })]),
      glyphOverflow: false,
      lineCount: 1,
    }));
  }
}

const started = performance.now();
const initialRss = process.memoryUsage().rss;

const acceptedSnapshot = (): GenealogySnapshot => ({
  schemaVersion: "1.0",
  projectId: asProjectId("project"),
  revisionId: asRevisionId("revision"),
  persons: Object.freeze([
    {
      id: asPersonId("1"),
      name: "محمد",
      parentId: null,
      generation: 1,
      sourceRowNumber: 2,
      explicitDisplayOrder: null,
    },
    {
      id: asPersonId("2"),
      name: "مهدي",
      parentId: asPersonId("1"),
      generation: 2,
      sourceRowNumber: 3,
      explicitDisplayOrder: 2,
    },
    {
      id: asPersonId("3"),
      name: "حيدر",
      parentId: asPersonId("1"),
      generation: 2,
      sourceRowNumber: 4,
      explicitDisplayOrder: 1,
    },
    {
      id: asPersonId("4"),
      name: "راضي",
      parentId: asPersonId("2"),
      generation: 3,
      sourceRowNumber: 5,
      explicitDisplayOrder: null,
    },
  ]),
  sourceChecksum: "a".repeat(64),
  createdAt: "2026-07-27T00:00:00.000Z",
  validationVersion: "1.0",
});

const templateBoundary: TemplateBoundary = {
  kind: "POLYGON",
  polygon: {
    points: [
      { x: 0, y: 0 },
      { x: 4_000, y: 0 },
      { x: 4_000, y: 2_500 },
      { x: 0, y: 2_500 },
    ],
  },
};

const snapshot = acceptedSnapshot();
const graph = buildGenealogyGraph(snapshot);
const selectedRootId = graph.roots.find((root) => root === "1") ?? graph.roots[0]!;
const demandPlan = await new DeterministicDemandEngine().compute({
  graph,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
});
const territoryResult = await new DeterministicTerritoryPlanner().plan({
  graph,
  demandPlan,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  templateBoundary,
  configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
  seed: 42,
});
if (!territoryResult.ok) throw new Error(JSON.stringify(territoryResult.errors));
const skeletonPlan = await new DeterministicSkeletonGrowthEngine().grow({
  graph,
  demandPlan,
  territoryPlan: territoryResult.value,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
  seed: 42,
});
const skeletonBranchMap = new Map<SkeletonBranchId, SkeletonBranch>(
  skeletonPlan.branches.map((branch) => [branch.id, branch]),
);
const labelBoundary: Polygon = {
  points: Object.freeze([
    { x: 0, y: 0 },
    { x: 5_000, y: 0 },
    { x: 5_000, y: 3_000 },
    { x: 0, y: 3_000 },
  ]),
};
const territoryPolygons = new Map<string, Polygon>();
for (const branch of skeletonPlan.branches) {
  if (branch.territoryId) territoryPolygons.set(branch.territoryId, labelBoundary);
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
const finalRss = process.memoryUsage().rss;
const report = {
  schemaVersion: "1.0",
  milestone: "7.3-part-2",
  dataset: "accepted-skeleton-validation-fixture",
  totalPersons: pipelineResult.layout.metrics.totalPersonCount,
  totalGeneratedCandidates: pipelineResult.diagnostics.totalGeneratedCandidates,
  totalValidCandidates: pipelineResult.diagnostics.totalValidCandidates,
  placedLabels: pipelineResult.layout.metrics.placedLabelCount,
  unresolvedLabels: pipelineResult.layout.metrics.unplacedLabelCount,
  overlapCount: pipelineResult.layout.metrics.totalOverlapCount,
  collisionCount: pipelineResult.layout.metrics.collisionCount,
  averageLeaderLength: pipelineResult.layout.metrics.averageAnchorDistance,
  maximumRotation: pipelineResult.layout.metrics.maximumRotation,
  minimumFontSize: pipelineResult.layout.metrics.minimumFontSize,
  totalRuntimeMilliseconds: Math.round((performance.now() - started) * 1000) / 1000,
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
