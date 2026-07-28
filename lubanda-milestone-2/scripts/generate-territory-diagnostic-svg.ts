import fs from "node:fs/promises";
import path from "node:path";
import {
  asProjectId,
  asRevisionId,
} from "../src/core/contracts/index.js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import {
  buildAcceptedGenealogySnapshot,
  buildGenealogyGraph,
} from "../src/core/genealogy/index.js";
import { XlsxGenealogyImporter } from "../src/core/import/index.js";
import {
  DeterministicTerritoryPlanner,
  type TemplateBoundary,
} from "../src/core/territory/index.js";
import { GenealogyValidator } from "../src/core/validation/index.js";

const xml = (value: unknown): string =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const points = (values: readonly { x: number; y: number }[]): string =>
  values.map((point) => `${point.x},${point.y}`).join(" ");
const workbookPath =
  process.env.LUBANDA_OFFICIAL_WORKBOOK ?? process.argv[2];
if (!workbookPath) throw new Error("Official workbook path is required");
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
const selectedRootId = graph.roots[0]!;
const demand = await new DeterministicDemandEngine().compute({
  graph,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
});
const demandById = new Map(
  demand.results.map((item) => [item.personId, item] as const),
);
const required = (graph.childrenByParentId.get(selectedRootId) ?? []).reduce(
  (sum, id) =>
    sum +
    Math.max(
      2_500,
      demandById.get(id)?.spatial.requiredArea ?? 0,
    ),
  0,
);
const planWidth = Math.max(6_000, Math.sqrt(Math.max(24_000_000, required * 2.5) * 1.6));
const planHeight = Math.max(4_000, Math.max(24_000_000, required * 2.5) / planWidth);
const template: TemplateBoundary = {
  kind: "POLYGON",
  polygon: {
    points: [
      { x: 0, y: 0 },
      { x: planWidth, y: 0 },
      { x: planWidth, y: planHeight },
      { x: 0, y: planHeight },
    ],
  },
};
const result = await new DeterministicTerritoryPlanner().plan({
  graph,
  demandPlan: demand,
  selectedRootId,
  sourceChecksum: snapshot.sourceChecksum,
  templateBoundary: template,
  configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
  seed: 1_386,
});
if (!result.ok) throw new Error(JSON.stringify(result.errors));
const plan = result.value;
const margin = 120;
const viewWidth = planWidth + margin * 2;
const viewHeight = planHeight + 620;
const colors = ["#5b8ff9", "#61d9a3", "#f6bd16", "#7262fd", "#78d3f8"];
const territorySvg = plan.territories.map((territory, index) => {
  const demandValue = demandById.get(territory.ownerLineageRootId)?.spatial.requiredArea ?? 0;
  return [
    `<polygon points="${points(territory.polygon.points)}" fill="${colors[index % colors.length]}" fill-opacity="0.22" stroke="#19324d" stroke-width="8"/>`,
    `<polygon points="${points(territory.clearanceEnvelope.polygon.points)}" fill="none" stroke="#607d8b" stroke-width="5" stroke-dasharray="18 12"/>`,
    `<text x="${territory.centroid.x}" y="${territory.centroid.y - 18}" text-anchor="middle" class="label">${xml(territory.id)}</text>`,
    `<text x="${territory.centroid.x}" y="${territory.centroid.y + 18}" text-anchor="middle" class="small">owner ${xml(territory.ownerLineageRootId)}</text>`,
    `<text x="${territory.centroid.x}" y="${territory.centroid.y + 52}" text-anchor="middle" class="small">demand ${demandValue.toFixed(1)} · area ${territory.area.toFixed(1)}</text>`,
    `<line x1="${plan.rootEntryReservation.center.x}" y1="${plan.rootEntryReservation.center.y}" x2="${territory.centroid.x}" y2="${territory.centroid.y}" stroke="#8d99ae" stroke-width="3" stroke-dasharray="12 12"/>`,
  ].join("\n");
}).join("\n");
const corridorSvg = plan.corridors.map((corridor) =>
  `<polyline points="${points(corridor.centerline)}" fill="none" stroke="#006d77" stroke-width="${corridor.width}" stroke-opacity="0.45"/><polyline points="${points(corridor.centerline)}" fill="none" stroke="#004c54" stroke-width="5"/>`,
).join("\n");
const junctionSvg = plan.junctionZones.map((zone) =>
  `<polygon points="${points(zone.polygon.points)}" fill="#ffb703" fill-opacity="0.28" stroke="#9c6500" stroke-width="5"/><text x="${zone.center.x}" y="${zone.center.y}" text-anchor="middle" class="tiny">${xml(zone.id)}</text>`,
).join("\n");
const beforePolygons = plan.negotiation.movements.length === 0
  ? plan.territories.map((territory) => territory.polygon)
  : plan.negotiation.movements
  .filter((movement) => movement.iteration === 1)
  .map((movement) => movement.before);
const beforeOutlines = beforePolygons.map((polygon) =>
  `<polygon points="${points(polygon.points)}" fill="none" stroke="#9b5de5" stroke-width="4" stroke-dasharray="16 12" opacity="0.75"/>`,
).join("\n");
const rejectedX = planWidth - 350;
const rejectedY = 70;
const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="${Math.round(1600 * viewHeight / viewWidth)}" viewBox="${-margin} ${-180} ${viewWidth} ${viewHeight}">
<style>.label{font:700 34px monospace;fill:#102a43}.small{font:24px monospace;fill:#243b53}.tiny{font:18px monospace;fill:#4a3500}.title{font:700 48px sans-serif;fill:#102a43}</style>
<rect x="${-margin}" y="-180" width="${viewWidth}" height="${viewHeight}" fill="#fbfcfe"/>
<text x="0" y="-105" class="title">Lubanda Milestone 2 — Engineering Territory Diagnostic</text>
<text x="0" y="-55" class="small">root ${xml(selectedRootId)} · people ${demand.results.length} · seed 1386 · validation ACCEPTED</text>
<polygon points="${points(plan.templatePolygon.points)}" fill="#eef3f8" stroke="#111827" stroke-width="12"/>
${beforeOutlines}
${territorySvg}
${corridorSvg}
${junctionSvg}
<polygon points="${points(plan.rootEntryReservation.polygon.points)}" fill="#ef476f" fill-opacity="0.28" stroke="#9d174d" stroke-width="7"/>
<text x="${plan.rootEntryReservation.center.x}" y="${plan.rootEntryReservation.center.y}" text-anchor="middle" class="small">root/trunk entry</text>
<polygon points="${rejectedX},${rejectedY} ${rejectedX + 140},${rejectedY} ${rejectedX + 35},${rejectedY + 20}" fill="#ff0000" fill-opacity="0.12" stroke="#d00000" stroke-width="5" stroke-dasharray="12 9"/>
<text x="${rejectedX - 10}" y="${rejectedY - 20}" text-anchor="end" class="tiny">rejected diagnostic candidate: insufficient/degenerate</text>
<text x="0" y="${planHeight + 110}" class="label">Legend / validation</text>
<text x="0" y="${planHeight + 160}" class="small">solid outline: accepted territory · dashed gray: boundary-margin clearance envelope</text>
<text x="0" y="${planHeight + 205}" class="small">purple dashed: initial outline (${plan.negotiation.iterations === 0 ? "identical; no transfer required" : "before transfer"}) · green: preliminary corridor · amber: junction reservation</text>
<text x="0" y="${planHeight + 250}" class="small">parent-child relation: root-entry to major-lineage territory · blocking issues: 0</text>
<text x="0" y="${planHeight + 295}" class="small">negotiation: ${xml(plan.negotiation.status)} in ${plan.negotiation.iterations} iteration(s) · ${plan.territories.length} territories · ${plan.corridors.length} corridors</text>
</svg>
`;
const outputPath = path.resolve("artifacts/milestone-2-territory-diagnostic.svg");
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, svg);
console.log(outputPath);
