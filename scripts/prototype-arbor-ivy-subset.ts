import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { Resvg } from "@resvg/resvg-js";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import { asProjectId, asRevisionId } from "../src/core/contracts/index.js";
import { DeterministicDemandEngine } from "../src/core/demand/index.js";
import { sha256Canonical } from "../src/core/determinism/index.js";
import {
  buildAcceptedGenealogySnapshot,
  buildGenealogyGraph,
  type GenealogyGraph,
  type GenealogySnapshot,
} from "../src/core/genealogy/index.js";
import { BotanicalLocalRelaxationEngine } from "../src/core/growth/index.js";
import { boundsFromPoints } from "../src/core/geometry/bounds.js";
import type { Polygon } from "../src/core/geometry/types.js";
import { XlsxGenealogyImporter } from "../src/core/import/index.js";
import {
  LabelLayoutEngine,
} from "../src/core/labels/index.js";
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
  type TerritoryPlan,
} from "../src/core/territory/index.js";
import { GenealogyValidator } from "../src/core/validation/index.js";

const workbookPath =
  process.env.LUBANDA_GOLDEN_WORKBOOK ??
  process.env.LUBANDA_OFFICIAL_WORKBOOK ??
  process.argv[2];
if (!workbookPath) throw new Error("Pass the Golden Dataset .xlsx path");
const outputDirectory = path.resolve(
  process.env.LUBANDA_PROTOTYPE_OUTPUT_DIR ?? "artifacts",
);
const seed = 1_386;
const PNG_WIDTH = 2_400;
const SUBSET_PER_LINEAGE = 54;
const format = (value: number): string =>
  (Math.round(value * 1_000) / 1_000).toString();
const escapeXml = (value: string): string =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll("\"", "&quot;");
const branchPath = (branch: SkeletonBranch): string =>
  `M ${format(branch.curve.p0.x)} ${format(branch.curve.p0.y)} ` +
  `C ${format(branch.curve.p1.x)} ${format(branch.curve.p1.y)} ` +
  `${format(branch.curve.p2.x)} ${format(branch.curve.p2.y)} ` +
  `${format(branch.curve.p3.x)} ${format(branch.curve.p3.y)}`;
const rasterize = (svg: string): Uint8Array =>
  new Resvg(svg, {
    background: "#f8faf7",
    fitTo: { mode: "width", value: PNG_WIDTH },
    font: { defaultFontFamily: "DejaVu Sans", loadSystemFonts: true },
  }).render().asPng();

const selectRepresentativeSubset = async (
  snapshot: GenealogySnapshot,
): Promise<GenealogySnapshot> => {
  const graph = buildGenealogyGraph(snapshot);
  const rootId = graph.roots[0];
  if (!rootId) throw new Error("Golden genealogy has no root");
  const selected = new Set([rootId]);
  const lineages = graph.childrenByParentId.get(rootId) ?? [];
  for (const lineageId of lineages) {
    const queue = [lineageId];
    let count = 0;
    while (queue.length > 0 && count < SUBSET_PER_LINEAGE) {
      const current = queue.shift();
      if (!current || selected.has(current)) continue;
      selected.add(current);
      count += 1;
      queue.push(...(graph.childrenByParentId.get(current) ?? []));
    }
  }
  const persons = snapshot.persons.filter((person) => selected.has(person.id));
  const sourceChecksum = await sha256Canonical(persons.map((person) => ({
    id: person.id,
    parentId: person.parentId,
    generation: person.generation,
    name: person.name,
  })));
  return {
    ...snapshot,
    projectId: asProjectId("lubanda-arbor-ivy-prototype"),
    revisionId: asRevisionId(`sha256:${sourceChecksum}`),
    persons: Object.freeze(persons),
    sourceChecksum,
    createdAt: "2026-07-29T00:00:00.000Z",
  };
};

const renderSkeleton = (
  title: string,
  subtitle: string,
  plan: SkeletonPlan,
  templatePolygon: Polygon,
): string => {
  const bounds = boundsFromPoints(templatePolygon.points);
  const margin = 100;
  const header = 190;
  const width = bounds.maxX - bounds.minX + margin * 2;
  const height = bounds.maxY - bounds.minY + margin * 2 + header;
  const trunkIds = new Set(plan.trunk.segments);
  const branches = [...plan.branches]
    .sort((left, right) =>
      left.metadata.branchIndex - right.metadata.branchIndex ||
      left.id.localeCompare(right.id)
    )
    .map((branch) => {
      const category = trunkIds.has(branch.id)
        ? "trunk"
        : branch.genealogyDepth === 1
          ? "primary"
          : branch.genealogyDepth === 2
            ? "secondary"
            : "twig";
      const strokeWidth = Math.max(
        1.25,
        (branch.thickness.baseThickness + branch.thickness.tipThickness) / 2,
      );
      return `<path class="${category}" data-branch-id="${escapeXml(branch.id)}" ` +
        `d="${branchPath(branch)}" stroke-width="${format(strokeWidth)}"/>`;
    }).join("\n");
  const polygon = templatePolygon.points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${format(point.x)} ${format(point.y)}`
  ).join(" ");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="` +
      `${format(bounds.minX - margin)} ${format(bounds.minY - margin - header)} ` +
      `${format(width)} ${format(height)}">`,
    `<style>`,
    `.bg{fill:#f8faf7}.boundary{fill:#fff;stroke:#cbd5c0;stroke-width:2;stroke-dasharray:10 8}`,
    `path{fill:none;stroke-linecap:round;stroke-linejoin:round}`,
    `.trunk{stroke:#243b2f}.primary{stroke:#355f42}.secondary{stroke:#4d7c5a}.twig{stroke:#719879}`,
    `.title{font:700 42px "DejaVu Sans";fill:#17261d}.subtitle{font:24px "DejaVu Sans";fill:#4b6354}`,
    `</style>`,
    `<rect class="bg" x="${format(bounds.minX - margin)}" ` +
      `y="${format(bounds.minY - margin - header)}" width="${format(width)}" height="${format(height)}"/>`,
    `<text class="title" x="${format(bounds.minX)}" y="${format(bounds.minY - 175)}">${escapeXml(title)}</text>`,
    `<text class="subtitle" x="${format(bounds.minX)}" y="${format(bounds.minY - 125)}">${escapeXml(subtitle)}</text>`,
    `<path class="boundary" d="${polygon} Z"/>`,
    `<g>${branches}</g>`,
    `</svg>`,
  ].join("\n");
};

const buildComparison = (
  panels: readonly { readonly title: string; readonly svg: string }[],
): string => {
  const inner = panels.map((panel, index) => {
    const content = panel.svg
      .replace(/^<\?xml[^>]*>\n?/, "")
      .replace(/^<svg[^>]*>/, "")
      .replace(/<\/svg>\s*$/, "");
    return `<svg x="${index * 34}%" y="0" width="32%" height="100%" ` +
      `viewBox="0 0 1 1" preserveAspectRatio="xMidYMid meet">` +
      `<foreignObject width="1" height="1">` +
      `<div xmlns="http://www.w3.org/1999/xhtml"></div></foreignObject>` +
      `</svg><g transform="translate(${index * 8_400} 0) scale(.8)">${content}</g>`;
  }).join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-100 -300 25200 6800">`,
    `<rect x="-100" y="-300" width="25200" height="6800" fill="#eef3ec"/>`,
    inner,
    `</svg>`,
  ].join("\n");
};

const sourceBytes = await fs.readFile(workbookPath);
const imported = await new XlsxGenealogyImporter().importWorkbook(
  sourceBytes.buffer.slice(
    sourceBytes.byteOffset,
    sourceBytes.byteOffset + sourceBytes.byteLength,
  ),
);
if (!imported.ok) throw new Error("Golden import failed");
const validation = await new GenealogyValidator().validate(imported.value);
if (!validation.accepted) throw new Error("Golden validation failed");
const fullSnapshot = buildAcceptedGenealogySnapshot(validation, {
  projectId: asProjectId("lubanda-arbor-ivy-prototype-source"),
  revisionId: asRevisionId(`sha256:${imported.value.sourceChecksum}`),
  createdAt: "2026-07-29T00:00:00.000Z",
});
const subset = await selectRepresentativeSubset(fullSnapshot);
const graph: GenealogyGraph = buildGenealogyGraph(subset);
const selectedRootId = graph.roots[0];
if (!selectedRootId) throw new Error("Prototype subset has no root");
const demandPlan = await new DeterministicDemandEngine().compute({
  graph,
  selectedRootId,
  sourceChecksum: subset.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
});
const territoryResult = await new DeterministicTerritoryPlanner().plan({
  graph,
  demandPlan,
  selectedRootId,
  sourceChecksum: subset.sourceChecksum,
  templateBoundary: {
    kind: "POLYGON",
    polygon: { points: [
      { x: 0, y: 0 }, { x: 8_000, y: 0 },
      { x: 8_000, y: 6_000 }, { x: 0, y: 6_000 },
    ] },
  },
  configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
  seed,
});
if (!territoryResult.ok) throw new Error("Prototype territory planning failed");
const territoryPlan: TerritoryPlan = territoryResult.value;
const current = await new DeterministicSkeletonGrowthEngine().grow({
  graph,
  demandPlan,
  territoryPlan,
  selectedRootId,
  sourceChecksum: subset.sourceChecksum,
  configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
  seed,
});
const engine = new BotanicalTerritoryGrowthEngine();
const arborOnly = await engine.grow({
  graph,
  skeletonPlan: current,
  territoryPlan,
  configuration: DEFAULT_ENGINE_CONFIGURATION,
  growth: { archetype: "oak", descendantStrategy: "ARBOR_ONLY" },
});
const hybridSolve = await engine.grow({
  graph,
  skeletonPlan: current,
  territoryPlan,
  configuration: DEFAULT_ENGINE_CONFIGURATION,
  growth: { archetype: "oak", descendantStrategy: "ARBOR_IVY" },
});
const hybridLabels = new LabelLayoutEngine().layout({
  graph,
  skeletonPlan: hybridSolve.skeletonPlan,
  templatePolygon: territoryPlan.templatePolygon,
  configuration: DEFAULT_ENGINE_CONFIGURATION,
});
const polished = await new BotanicalLocalRelaxationEngine().relax({
  graph,
  skeletonPlan: hybridSolve.skeletonPlan,
  territoryPlan,
  configuration: DEFAULT_ENGINE_CONFIGURATION,
  labelLayout: hybridLabels,
  relaxation: {
    maxIterations: 6,
    initialStepRatio: 0.02,
    maximumControlPointMovement: 4,
    preserveLabelPlacements: true,
  },
});
const variants = [
  {
    id: "current",
    title: "1. Current Engine",
    subtitle: "Accepted deterministic skeleton before territory redesign",
    plan: current,
  },
  {
    id: "arbor-only",
    title: "2. Botanical Territory Growth",
    subtitle: "Oak load-bearing hierarchy without ivy space seeking",
    plan: arborOnly.skeletonPlan,
  },
  {
    id: "hybrid-arbor-ivy",
    title: "3. Hybrid Arbor–Ivy",
    subtitle: `Oak hierarchy + ivy space seeking + Local Relaxation (${polished.status.toLowerCase()})`,
    plan: polished.skeletonPlan,
  },
] as const;
await fs.mkdir(outputDirectory, { recursive: true });
const rendered: Array<{ readonly title: string; readonly svg: string }> = [];
for (const variant of variants) {
  const svg = renderSkeleton(
    variant.title,
    variant.subtitle,
    variant.plan,
    territoryPlan.templatePolygon,
  );
  rendered.push({ title: variant.title, svg });
  await Promise.all([
    fs.writeFile(
      path.join(outputDirectory, `arbor-ivy-prototype-${variant.id}.svg`),
      svg,
      "utf8",
    ),
    fs.writeFile(
      path.join(outputDirectory, `arbor-ivy-prototype-${variant.id}.png`),
      rasterize(svg),
    ),
  ]);
}
const comparisonSvg = buildComparison(rendered);
await Promise.all([
  fs.writeFile(
    path.join(outputDirectory, "arbor-ivy-prototype-comparison.svg"),
    comparisonSvg,
    "utf8",
  ),
  fs.writeFile(
    path.join(outputDirectory, "arbor-ivy-prototype-comparison.png"),
    rasterize(comparisonSvg),
  ),
]);
const report = {
  schemaVersion: "1.0",
  milestone: "BOTANICAL_TERRITORY_GROWTH_PROTOTYPE",
  selectionStatus: "SELECTED_AFTER_VISUAL_REVIEW",
  selectedVariant: "hybrid-arbor-ivy",
  visualSelectionRationale:
    "The hybrid preserves the oak-like dominant trunk and primary limbs while " +
    "breaking the Arbor-only terminal wall into visibly irregular, multi-directional " +
    "crown edges. The current engine remains visibly graph-like.",
  sourceFileSha256: createHash("sha256").update(sourceBytes).digest("hex"),
  subsetPersonCount: subset.persons.length,
  selectedRootId,
  majorLineageCount:
    graph.childrenByParentId.get(selectedRootId)?.length ?? 0,
  archetype: "oak",
  variants: variants.map((variant) => ({
    id: variant.id,
    branchCount: variant.plan.branches.length,
    intersectionCount: variant.plan.validation.metrics.intersectionCount,
    deterministicFingerprint: variant.plan.deterministicFingerprint,
  })),
  localRelaxation: {
    status: polished.status,
    movedBranchCount: polished.metrics.movedBranchCount,
    deterministicFingerprint: polished.deterministicFingerprint,
  },
  artifacts: Object.fromEntries([
    ...variants.flatMap((variant) => [
      [`${variant.id}Svg`, `artifacts/arbor-ivy-prototype-${variant.id}.svg`],
      [`${variant.id}Png`, `artifacts/arbor-ivy-prototype-${variant.id}.png`],
    ]),
    ["comparisonSvg", "artifacts/arbor-ivy-prototype-comparison.svg"],
    ["comparisonPng", "artifacts/arbor-ivy-prototype-comparison.png"],
  ]),
  deterministicFingerprint: await sha256Canonical({
    subsetChecksum: subset.sourceChecksum,
    variants: variants.map((variant) =>
      variant.plan.deterministicFingerprint
    ),
    localRelaxation: polished.deterministicFingerprint,
  }),
};
await fs.writeFile(
  path.join(outputDirectory, "arbor-ivy-prototype-report.json"),
  `${JSON.stringify(report, null, 2)}\n`,
  "utf8",
);
console.log(path.join(outputDirectory, "arbor-ivy-prototype-report.json"));
