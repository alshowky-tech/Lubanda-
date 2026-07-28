import { writeFileSync } from "node:fs";
import { DEFAULT_ENGINE_CONFIGURATION } from "../src/core/config/index.js";
import { buildGenealogyGraph } from "../src/core/genealogy/graph.js";
import { DeterministicDemandEngine } from "../src/core/demand/DemandEngine.js";
import { DeterministicTerritoryPlanner } from "../src/core/territory/TerritoryPlanner.js";
import { DeterministicSkeletonGrowthEngine } from "../src/core/skeleton/SkeletonGrowthEngine.js";
import { acceptedSnapshot } from "../tests/helpers/genealogy-builders.js";
import { rectangularTemplate } from "../tests/helpers/territory-builders.js";
import type { Vec2 } from "../src/core/geometry/types.js";

const SVG_WIDTH = 800;
const SVG_HEIGHT = 600;

const scaleX = (x: number, min: number, max: number): number =>
  ((x - min) / (max - min)) * SVG_WIDTH * 0.9 + SVG_WIDTH * 0.05;

const scaleY = (y: number, min: number, max: number): number =>
  ((y - min) / (max - min)) * SVG_HEIGHT * 0.9 + SVG_HEIGHT * 0.05;

const curvePath = (
  p0: Vec2,
  p1: Vec2,
  p2: Vec2,
  p3: Vec2,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): string =>
  `M ${scaleX(p0.x, minX, maxX)} ${scaleY(p0.y, minY, maxY)} ` +
  `C ${scaleX(p1.x, minX, maxX)} ${scaleY(p1.y, minY, maxY)} ` +
  `${scaleX(p2.x, minX, maxX)} ${scaleY(p2.y, minY, maxY)} ` +
  `${scaleX(p3.x, minX, maxX)} ${scaleY(p3.y, minY, maxY)}`;

async function main(): Promise<void> {
  const snapshot = acceptedSnapshot();
  const graph = buildGenealogyGraph(snapshot);
  const selectedRootId = graph.roots[0]!;
  const sourceChecksum = snapshot.sourceChecksum;
  const templateBoundary = rectangularTemplate(2000, 1800);

  const demandPlan = await new DeterministicDemandEngine().compute({
    graph,
    selectedRootId,
    sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.demand,
  });

  const territoryResult = await new DeterministicTerritoryPlanner().plan({
    graph,
    demandPlan,
    selectedRootId,
    sourceChecksum,
    templateBoundary,
    configuration: DEFAULT_ENGINE_CONFIGURATION.territory,
    seed: 42,
  });

  if (!territoryResult.ok) {
    console.error("Territory planning failed");
    process.exit(1);
  }

  const skeletonPlan = await new DeterministicSkeletonGrowthEngine().grow({
    graph,
    demandPlan,
    territoryPlan: territoryResult.value,
    selectedRootId,
    sourceChecksum,
    configuration: DEFAULT_ENGINE_CONFIGURATION.skeleton,
    seed: 42,
  });

  // Calculate bounds for scaling
  const allPoints: Vec2[] = [
    ...territoryResult.value.templatePolygon.points,
    ...skeletonPlan.branches.flatMap((b) => [b.curve.p0, b.curve.p1, b.curve.p2, b.curve.p3]),
    ...skeletonPlan.nodes.map((n) => n.point),
  ];
  const minX = Math.min(...allPoints.map((p) => p.x)) - 50;
  const maxX = Math.max(...allPoints.map((p) => p.x)) + 50;
  const minY = Math.min(...allPoints.map((p) => p.y)) - 50;
  const maxY = Math.max(...allPoints.map((p) => p.y)) + 50;

  // Build SVG parts
  const lines: string[] = [];

  // Template boundary
  const templatePath = territoryResult.value.templatePolygon.points
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"} ${scaleX(p.x, minX, maxX)} ${scaleY(p.y, minY, maxY)}`,
    )
    .join(" ") + " Z";
  lines.push(
    `<path d="${templatePath}" fill="none" stroke="#ccc" stroke-width="1.5" stroke-dasharray="6,3"/>`,
  );

  // Territory polygons
  for (const territory of territoryResult.value.territories) {
    const path = territory.polygon.points
      .map(
        (p, i) =>
          `${i === 0 ? "M" : "L"} ${scaleX(p.x, minX, maxX)} ${scaleY(p.y, minY, maxY)}`,
      )
      .join(" ") + " Z";
    lines.push(
      `<path d="${path}" fill="rgba(144, 238, 144, 0.15)" stroke="#8f8" stroke-width="1"/>`,
    );
  }

  // Trunk (thick brown)
  for (const branchId of skeletonPlan.trunk.segments) {
    const branch = skeletonPlan.branches.find((b) => b.id === branchId);
    if (!branch) continue;
    lines.push(
      `<path d="${curvePath(branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3, minX, maxX, minY, maxY)}" fill="none" stroke="#8B4513" stroke-width="${branch.thickness.baseThickness}" stroke-linecap="round"/>`,
    );
  }

  // Regular branches (thinner, green-brown)
  for (const branch of skeletonPlan.branches) {
    if (branch.generation === 0) continue; // trunk already drawn
    lines.push(
      `<path d="${curvePath(branch.curve.p0, branch.curve.p1, branch.curve.p2, branch.curve.p3, minX, maxX, minY, maxY)}" fill="none" stroke="#556B2F" stroke-width="${Math.max(2, branch.thickness.baseThickness)}" stroke-linecap="round" opacity="0.8"/>`,
    );
  }

  // Nodes (small circles)
  for (const node of skeletonPlan.nodes) {
    const cx = scaleX(node.point.x, minX, maxX);
    const cy = scaleY(node.point.y, minY, maxY);
    lines.push(
      `<circle cx="${cx}" cy="${cy}" r="3" fill="${
        node.kind === "TRUNK_BASE" || node.kind === "TRUNK_JUNCTION" || node.kind === "TRUNK_TERMINAL"
          ? "#8B4513"
          : node.kind === "BRANCH_SPLIT"
            ? "#FF8C00"
            : "#333"
      }" stroke="none"/>`,
    );
  }

  // Legend
  lines.push(
    `<rect x="20" y="20" width="180" height="80" fill="white" stroke="#ccc" rx="4"/>`,
    `<text x="30" y="40" font-size="11" fill="#333">Trunk</text>`,
    `<line x1="100" y1="35" x2="140" y2="35" stroke="#8B4513" stroke-width="4"/>`,
    `<text x="30" y="58" font-size="11" fill="#333">Branches</text>`,
    `<line x1="100" y1="53" x2="140" y2="53" stroke="#556B2F" stroke-width="2"/>`,
    `<text x="30" y="76" font-size="11" fill="#333">Junction</text>`,
    `<circle cx="120" cy="71" r="3" fill="#FF8C00"/>`,
    `<text x="30" y="94" font-size="11" fill="#333">Territory</text>`,
    `<rect x="100" y="82" width="40" height="9" fill="rgba(144, 238, 144, 0.3)" stroke="#8f8" stroke-width="0.5"/>`,
  );

  // Info text
  lines.push(
    `<text x="20" y="${SVG_HEIGHT - 20}" font-size="10" fill="#666">` +
      `Milestone 3 Skeleton Diagnostic — ` +
      `${skeletonPlan.branches.length} branches, ` +
      `${skeletonPlan.nodes.length} nodes, ` +
      `${skeletonPlan.mappedJunctions.length} junctions, ` +
      `seed ${skeletonPlan.seed}` +
      `</text>`,
  );

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SVG_WIDTH} ${SVG_HEIGHT}" width="${SVG_WIDTH}" height="${SVG_HEIGHT}">\n${lines.join("\n")}\n</svg>`;

  const outPath = "artifacts/milestone-3-skeleton-diagnostic.svg";
  writeFileSync(outPath, svg, "utf8");
  console.log(`Wrote ${outPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
