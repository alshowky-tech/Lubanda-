import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  asProjectId,
  asRevisionId,
} from "../src/core/contracts/index.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import {
  canonicalJson,
  sha256Canonical,
} from "../src/core/determinism/index.js";
import {
  buildGenealogyGraph,
  buildAcceptedGenealogySnapshot,
} from "../src/core/genealogy/index.js";
import { XlsxGenealogyImporter } from "../src/core/import/index.js";
import {
  DeterministicTerritoryPlanner,
  type TemplateBoundary,
} from "../src/core/territory/index.js";
import { GenealogyValidator } from "../src/core/validation/index.js";

const workbookPath =
  process.env.LUBANDA_OFFICIAL_WORKBOOK ?? process.argv[2];
if (!workbookPath) {
  throw new Error(
    "Set LUBANDA_OFFICIAL_WORKBOOK or pass the official workbook path",
  );
}
const started = performance.now();
const initialRss = process.memoryUsage().rss;
const bytes = await fs.readFile(workbookPath);
const imported = await new XlsxGenealogyImporter().importWorkbook(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
if (!imported.ok) throw new Error(JSON.stringify(imported.errors));
const validation = new GenealogyValidator().validate(imported.value);
if (!validation.accepted) throw new Error(JSON.stringify(validation.issues));
const snapshot = buildAcceptedGenealogySnapshot(validation, {
  projectId: asProjectId("lubanda-official"),
  revisionId: asRevisionId(`sha256:${imported.value.sourceChecksum}`),
  createdAt: "2026-07-28T00:00:00.000Z",
});
const graph = buildGenealogyGraph(snapshot);
if (graph.roots.length === 0) throw new Error("Official snapshot has no root");
const selectedRootId = graph.roots[0]!;
const demandPlan = await new DeterministicDemandEngine().compute({
  graph,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
});
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
const planner = new DeterministicTerritoryPlanner();
const planningInput = {
  graph,
  demandPlan,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  templateBoundary,
  configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
  seed,
} as const;
const first = await planner.plan(planningInput);
const second = await planner.plan(planningInput);
if (!first.ok) throw new Error(JSON.stringify(first.errors));
if (!second.ok) throw new Error(JSON.stringify(second.errors));
const firstBytes = new TextEncoder().encode(canonicalJson(first.value));
const secondBytes = new TextEncoder().encode(canonicalJson(second.value));
if (
  firstBytes.length !== secondBytes.length ||
  !firstBytes.every((value, index) => value === secondBytes[index])
) {
  throw new Error("Deterministic replay mismatch");
}
const replayChecksum = await sha256Canonical(first.value);
const report = {
  schemaVersion: "1.0",
  benchmark: "OFFICIAL_1386_PERSON_WORKBOOK",
  selectedRoot: selectedRootId,
  includedPeople: demandPlan.results.length,
  majorLineageCount: majorLineageIds.length,
  totalDemand: demandPlan.totalRequiredArea,
  perLineageDemand: majorLineageIds.map((id) => ({
    lineageId: id,
    descendantCount: demandById.get(id)?.raw.descendantCount ?? 0,
    requiredArea: demandById.get(id)?.spatial.requiredArea ?? 0,
  })),
  territoryAreas: first.value.territories.map((territory) => ({
    territoryId: territory.id,
    ownerLineageRootId: territory.ownerLineageRootId,
    requiredArea: territory.requiredArea,
    allocatedArea: territory.area,
  })),
  negotiationIterations: first.value.negotiation.iterations,
  negotiationStatus: first.value.negotiation.status,
  validationOutcome: first.value.validation.accepted ? "ACCEPTED" : "REJECTED",
  validationMetrics: first.value.validation.metrics,
  runtimeMilliseconds: Math.round((performance.now() - started) * 1000) / 1000,
  peakMemory: {
    measurable: true,
    method: "process.rss high-water approximation over benchmark boundaries",
    initialRssBytes: initialRss,
    finalRssBytes: process.memoryUsage().rss,
    peakRssBytes: Math.max(initialRss, process.memoryUsage().rss),
  },
  sourceChecksum: snapshot.sourceChecksum,
  demandFingerprint: demandPlan.computationMetadata.deterministicFingerprint,
  territoryFingerprint: first.value.deterministicFingerprint,
  deterministicReplayChecksum: replayChecksum,
  canonicalSerializedBytes: firstBytes.length,
  replayByteIdentical: true,
  templateBoundary,
};
const outputPath = path.resolve(
  "artifacts/official-milestone-2-benchmark.json",
);
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(outputPath);
