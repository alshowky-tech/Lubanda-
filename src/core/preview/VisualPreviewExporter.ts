import { sha256Canonical } from "../determinism/canonical-json.js";
import { roundDeterministic } from "../determinism/numeric.js";
import {
  approximateCubicBezierBounds,
} from "../geometry/bezier.js";
import { boundsFromPoints, expandBounds } from "../geometry/bounds.js";
import type { Bounds, Polygon } from "../geometry/types.js";
import type { GenealogyGraph } from "../genealogy/graph.js";
import type {
  LabelLayoutResult,
  LabelPlacement,
} from "../labels/types.js";
import type {
  SkeletonBranch,
  SkeletonPlan,
} from "../skeleton/types.js";

const METRIC_DECIMAL_PLACES = 6;
const SVG_MARGIN = 80;
const SVG_HEADER_HEIGHT = 150;

export type PreviewBranchCategory = "TRUNK" | "ORGANIC" | "RECOVERY";
export type PreviewLabelCategory = "BRANCH_ATTACHED" | "FALLBACK_LANE";

export interface BranchLengthDistribution {
  readonly count: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly mean: number;
  readonly median: number;
  readonly p90: number;
  readonly p95: number;
  readonly total: number;
}

export interface VisualPreviewMetrics {
  readonly skeletonCoverage: number;
  readonly labelCoverage: number;
  readonly branchCount: number;
  readonly trunkBranchCount: number;
  readonly organicBranchCount: number;
  readonly recoveryBranchCount: number;
  readonly branchAttachedLabelCount: number;
  readonly fallbackLaneLabelCount: number;
  readonly minimumLabelFontSize: number;
  readonly skeletonBounds: Bounds;
  readonly labelBounds: Bounds | null;
  readonly treeBounds: Bounds;
  readonly labelArea: number;
  readonly labelDensity: number;
  readonly branchLengthDistribution: BranchLengthDistribution;
}

export interface VisualPreviewInput {
  readonly graph: GenealogyGraph;
  readonly skeletonPlan: SkeletonPlan;
  readonly labelLayout: LabelLayoutResult;
  readonly templatePolygon: Polygon;
}

export interface VisualPreviewResult {
  readonly svg: string;
  readonly metrics: VisualPreviewMetrics;
  readonly deterministicFingerprint: string;
}

const round = (value: number): number =>
  roundDeterministic(value, METRIC_DECIMAL_PLACES);

const format = (value: number): string => {
  const rounded = round(value);
  return Number.isInteger(rounded)
    ? rounded.toString()
    : rounded.toFixed(METRIC_DECIMAL_PLACES).replace(/0+$/, "").replace(/\.$/, "");
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");

const unionBounds = (left: Bounds, right: Bounds): Bounds => ({
  minX: Math.min(left.minX, right.minX),
  minY: Math.min(left.minY, right.minY),
  maxX: Math.max(left.maxX, right.maxX),
  maxY: Math.max(left.maxY, right.maxY),
});

const boundsArea = (bounds: Bounds): number =>
  Math.max(0, bounds.maxX - bounds.minX) *
  Math.max(0, bounds.maxY - bounds.minY);

const placementArea = (placement: LabelPlacement): number =>
  boundsArea(placement.bounds);

const percentile = (sorted: readonly number[], ratio: number): number => {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0] as number;
  const position = (sorted.length - 1) * ratio;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex] as number;
  const upper = sorted[upperIndex] as number;
  return lower + (upper - lower) * (position - lowerIndex);
};

const branchLengthDistribution = (
  branches: readonly SkeletonBranch[],
): BranchLengthDistribution => {
  const lengths = branches
    .map((branch) => branch.length)
    .sort((left, right) => left - right);
  const total = lengths.reduce((sum, length) => sum + length, 0);
  return {
    count: lengths.length,
    minimum: round(lengths[0] ?? 0),
    maximum: round(lengths[lengths.length - 1] ?? 0),
    mean: round(lengths.length === 0 ? 0 : total / lengths.length),
    median: round(percentile(lengths, 0.5)),
    p90: round(percentile(lengths, 0.9)),
    p95: round(percentile(lengths, 0.95)),
    total: round(total),
  };
};

export const classifyPreviewBranch = (
  branch: SkeletonBranch,
  trunkBranchIds: ReadonlySet<string>,
): PreviewBranchCategory => {
  if (trunkBranchIds.has(branch.id)) return "TRUNK";
  return branch.id.startsWith("layered:") ? "RECOVERY" : "ORGANIC";
};

export const classifyPreviewLabel = (
  placement: LabelPlacement,
): PreviewLabelCategory =>
  placement.candidateId.includes(":fallback:")
    ? "FALLBACK_LANE"
    : "BRANCH_ATTACHED";

const computeSkeletonBounds = (
  branches: readonly SkeletonBranch[],
): Bounds => {
  const first = branches[0];
  if (first === undefined) {
    throw new RangeError("Visual preview requires at least one skeleton branch");
  }
  const branchBounds = branches.map((branch) =>
    expandBounds(
      approximateCubicBezierBounds(branch.curve, {
        tolerance: 0.5,
        maxSubdivisionDepth: 20,
      }),
      Math.max(
        branch.thickness.baseThickness,
        branch.thickness.tipThickness,
      ) / 2,
    ),
  );
  return branchBounds.slice(1).reduce(
    unionBounds,
    branchBounds[0] as Bounds,
  );
};

const computeLabelBounds = (
  placements: readonly LabelPlacement[],
): Bounds | null => {
  const first = placements[0];
  if (first === undefined) return null;
  return placements.slice(1).reduce(
    (bounds, placement) => unionBounds(bounds, placement.bounds),
    first.bounds,
  );
};

const computeMetrics = (
  input: VisualPreviewInput,
): VisualPreviewMetrics => {
  const trunkBranchIds = new Set<string>(input.skeletonPlan.trunk.segments);
  const categories = input.skeletonPlan.branches.map((branch) =>
    classifyPreviewBranch(branch, trunkBranchIds),
  );
  const labelCategories = input.labelLayout.placements.map(
    classifyPreviewLabel,
  );
  const skeletonBounds = computeSkeletonBounds(input.skeletonPlan.branches);
  const labelBounds = computeLabelBounds(input.labelLayout.placements);
  const treeBounds = labelBounds === null
    ? skeletonBounds
    : unionBounds(skeletonBounds, labelBounds);
  const labelArea = input.labelLayout.placements.reduce(
    (total, placement) => total + placementArea(placement),
    0,
  );
  return Object.freeze({
    skeletonCoverage: new Set(
      input.skeletonPlan.branches.map((branch) => branch.ownerPersonId),
    ).size,
    labelCoverage: new Set(
      input.labelLayout.placements.map((placement) => placement.personId),
    ).size,
    branchCount: input.skeletonPlan.branches.length,
    trunkBranchCount: categories.filter((category) => category === "TRUNK").length,
    organicBranchCount: categories.filter((category) => category === "ORGANIC").length,
    recoveryBranchCount: categories.filter((category) => category === "RECOVERY").length,
    branchAttachedLabelCount: labelCategories.filter(
      (category) => category === "BRANCH_ATTACHED",
    ).length,
    fallbackLaneLabelCount: labelCategories.filter(
      (category) => category === "FALLBACK_LANE",
    ).length,
    minimumLabelFontSize: round(
      input.labelLayout.placements.length === 0
        ? 0
        : Math.min(
            ...input.labelLayout.placements.map(
              (placement) => placement.fontSize,
            ),
          ),
    ),
    skeletonBounds: Object.freeze({
      minX: round(skeletonBounds.minX),
      minY: round(skeletonBounds.minY),
      maxX: round(skeletonBounds.maxX),
      maxY: round(skeletonBounds.maxY),
    }),
    labelBounds: labelBounds === null
      ? null
      : Object.freeze({
          minX: round(labelBounds.minX),
          minY: round(labelBounds.minY),
          maxX: round(labelBounds.maxX),
          maxY: round(labelBounds.maxY),
        }),
    treeBounds: Object.freeze({
      minX: round(treeBounds.minX),
      minY: round(treeBounds.minY),
      maxX: round(treeBounds.maxX),
      maxY: round(treeBounds.maxY),
    }),
    labelArea: round(labelArea),
    labelDensity: round(
      boundsArea(treeBounds) === 0 ? 0 : labelArea / boundsArea(treeBounds),
    ),
    branchLengthDistribution: Object.freeze(
      branchLengthDistribution(input.skeletonPlan.branches),
    ),
  });
};

const branchPath = (branch: SkeletonBranch): string =>
  `M ${format(branch.curve.p0.x)} ${format(branch.curve.p0.y)} ` +
  `C ${format(branch.curve.p1.x)} ${format(branch.curve.p1.y)} ` +
  `${format(branch.curve.p2.x)} ${format(branch.curve.p2.y)} ` +
  `${format(branch.curve.p3.x)} ${format(branch.curve.p3.y)}`;

const polygonPath = (polygon: Polygon): string =>
  `${polygon.points.map((point, index) =>
    `${index === 0 ? "M" : "L"} ${format(point.x)} ${format(point.y)}`,
  ).join(" ")} Z`;

const renderBranch = (
  branch: SkeletonBranch,
  category: PreviewBranchCategory,
): string => {
  const strokeWidth = Math.max(
    1.5,
    (branch.thickness.baseThickness + branch.thickness.tipThickness) / 2,
  );
  return `<path class="branch branch-${category.toLowerCase()}" ` +
    `data-branch-id="${escapeXml(branch.id)}" ` +
    `data-owner-person-id="${escapeXml(branch.ownerPersonId)}" ` +
    `d="${branchPath(branch)}" stroke-width="${format(strokeWidth)}"/>`;
};

const renderLabel = (
  placement: LabelPlacement,
  name: string,
  category: PreviewLabelCategory,
): string => {
  const className = category === "FALLBACK_LANE"
    ? "label label-fallback"
    : "label label-attached";
  const rotation = placement.rotationDegrees === 0
    ? ""
    : ` transform="rotate(${format(placement.rotationDegrees)} ` +
      `${format(placement.anchor.x)} ${format(placement.anchor.y)})"`;
  return [
    `<g class="${className}" data-person-id="${escapeXml(placement.personId)}" ` +
      `data-candidate-id="${escapeXml(placement.candidateId)}">`,
    `<rect x="${format(placement.bounds.minX)}" ` +
      `y="${format(placement.bounds.minY)}" ` +
      `width="${format(placement.bounds.maxX - placement.bounds.minX)}" ` +
      `height="${format(placement.bounds.maxY - placement.bounds.minY)}" rx="4"/>`,
    `<text x="${format(placement.anchor.x)}" ` +
      `y="${format(placement.anchor.y + placement.fontSize * 0.35)}" ` +
      `font-size="${format(placement.fontSize)}"${rotation}>${escapeXml(name)}</text>`,
    "</g>",
  ].join("");
};

const buildSvg = (
  input: VisualPreviewInput,
  metrics: VisualPreviewMetrics,
  deterministicFingerprint: string,
): string => {
  const templateBounds = boundsFromPoints(input.templatePolygon.points);
  const contentBounds = unionBounds(templateBounds, metrics.treeBounds);
  const viewBounds = {
    minX: contentBounds.minX - SVG_MARGIN,
    minY: contentBounds.minY - SVG_MARGIN - SVG_HEADER_HEIGHT,
    maxX: contentBounds.maxX + SVG_MARGIN,
    maxY: contentBounds.maxY + SVG_MARGIN,
  };
  const width = viewBounds.maxX - viewBounds.minX;
  const height = viewBounds.maxY - viewBounds.minY;
  const trunkBranchIds = new Set<string>(input.skeletonPlan.trunk.segments);
  const branches = [...input.skeletonPlan.branches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((branch) =>
      renderBranch(
        branch,
        classifyPreviewBranch(branch, trunkBranchIds),
      ),
    )
    .join("\n");
  const labels = [...input.labelLayout.placements]
    .sort((left, right) => left.personId.localeCompare(right.personId))
    .map((placement) => {
      const person = input.graph.personsById.get(placement.personId);
      if (person === undefined) {
        throw new RangeError(
          `Label placement references unknown person: ${placement.personId}`,
        );
      }
      return renderLabel(
        placement,
        person.name,
        classifyPreviewLabel(placement),
      );
    })
    .join("\n");
  const headerX = contentBounds.minX;
  const titleY = contentBounds.minY - 105;
  const legendY = contentBounds.minY - 65;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="${format(viewBounds.minX)} ${format(viewBounds.minY)} ` +
      `${format(width)} ${format(height)}" ` +
      `width="${format(width)}" height="${format(height)}">`,
    `<metadata>visual-fingerprint:${deterministicFingerprint}</metadata>`,
    `<style>`,
    `.background{fill:#fff}.template{fill:none;stroke:#94a3b8;stroke-width:2;stroke-dasharray:12 8}`,
    `.branch{fill:none;stroke-linecap:round;stroke-linejoin:round}`,
    `.branch-trunk{stroke:#334155}.branch-organic{stroke:#0f766e}`,
    `.branch-recovery{stroke:#d97706;stroke-dasharray:9 6;opacity:.82}`,
    `.label rect{stroke-width:1.25}.label text{text-anchor:middle;font-family:"DejaVu Sans",sans-serif;direction:rtl;unicode-bidi:plaintext}`,
    `.label-attached rect{fill:#eff6ff;stroke:#2563eb}.label-attached text{fill:#1e3a8a}`,
    `.label-fallback rect{fill:#faf5ff;stroke:#9333ea;stroke-dasharray:4 3}.label-fallback text{fill:#581c87}`,
    `.legend-attached{fill:#eff6ff;stroke:#2563eb;stroke-width:1.5}`,
    `.legend-fallback{fill:#faf5ff;stroke:#9333ea;stroke-width:1.5;stroke-dasharray:4 3}`,
    `.title{font:700 30px "DejaVu Sans",sans-serif;fill:#0f172a}`,
    `.legend{font:18px "DejaVu Sans",sans-serif;fill:#334155}`,
    `</style>`,
    `<rect class="background" x="${format(viewBounds.minX)}" ` +
      `y="${format(viewBounds.minY)}" width="${format(width)}" height="${format(height)}"/>`,
    `<text class="title" x="${format(headerX)}" y="${format(titleY)}">` +
      `Lubanda Golden Dataset — Visual Validation Preview</text>`,
    `<g class="legend">`,
    `<line x1="${format(headerX)}" y1="${format(legendY)}" ` +
      `x2="${format(headerX + 70)}" y2="${format(legendY)}" ` +
      `class="branch branch-organic" stroke-width="5"/>`,
    `<text x="${format(headerX + 82)}" y="${format(legendY + 6)}">` +
      `Organic branches: ${metrics.organicBranchCount}</text>`,
    `<line x1="${format(headerX + 360)}" y1="${format(legendY)}" ` +
      `x2="${format(headerX + 430)}" y2="${format(legendY)}" ` +
      `class="branch branch-recovery" stroke-width="5"/>`,
    `<text x="${format(headerX + 442)}" y="${format(legendY + 6)}">` +
      `Recovery branches: ${metrics.recoveryBranchCount}</text>`,
    `<rect x="${format(headerX + 780)}" y="${format(legendY - 18)}" ` +
      `width="56" height="26" rx="4" class="legend-attached"/>`,
    `<text x="${format(headerX + 848)}" y="${format(legendY + 6)}">` +
      `Branch-attached labels: ${metrics.branchAttachedLabelCount}</text>`,
    `<rect x="${format(headerX + 1210)}" y="${format(legendY - 18)}" ` +
      `width="56" height="26" rx="4" class="legend-fallback"/>`,
    `<text x="${format(headerX + 1278)}" y="${format(legendY + 6)}">` +
      `Fallback lane labels: ${metrics.fallbackLaneLabelCount}</text>`,
    `</g>`,
    `<path class="template" d="${polygonPath(input.templatePolygon)}"/>`,
    `<g id="skeleton">${branches}</g>`,
    `<g id="labels">${labels}</g>`,
    `</svg>`,
    "",
  ].join("\n");
};

export class VisualPreviewExporter {
  async export(input: VisualPreviewInput): Promise<VisualPreviewResult> {
    if (input.skeletonPlan.status !== "ACCEPTED") {
      throw new TypeError("Visual preview requires an accepted skeleton plan");
    }
    if (input.labelLayout.status !== "ACCEPTED") {
      throw new TypeError("Visual preview requires a complete accepted label layout");
    }
    const metrics = computeMetrics(input);
    const deterministicPlacements = [...input.labelLayout.placements].sort(
      (left, right) =>
        left.personId.localeCompare(right.personId) ||
        left.candidateId.localeCompare(right.candidateId),
    );
    const deterministicFingerprint = await sha256Canonical({
      skeletonFingerprint: input.skeletonPlan.deterministicFingerprint,
      placements: deterministicPlacements,
      metrics,
    });
    return Object.freeze({
      svg: buildSvg(input, metrics, deterministicFingerprint),
      metrics,
      deterministicFingerprint,
    });
  }
}
