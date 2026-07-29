import { XMLParser } from "fast-xml-parser";
import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import type {
  PersonId,
  SkeletonBranchId,
} from "../../../src/core/contracts/identifiers.js";
import { LabelLayoutEngine } from "../../../src/core/labels/LabelLayoutEngine.js";
import type { LabelPlacement } from "../../../src/core/labels/types.js";
import {
  classifyPreviewBranch,
  classifyPreviewLabel,
  VisualPreviewExporter,
} from "../../../src/core/preview/VisualPreviewExporter.js";
import type { SkeletonBranch } from "../../../src/core/skeleton/types.js";
import { acceptedSnapshot } from "../../helpers/genealogy-builders.js";
import {
  growSkeleton,
  rectangularTemplate,
} from "../../helpers/skeleton-builders.js";

const placement = (candidateId: string): LabelPlacement => ({
  placementId: "label:p1",
  candidateId,
  personId: "p1" as PersonId,
  anchor: { x: 10, y: 10 },
  bounds: { minX: 0, minY: 0, maxX: 20, maxY: 20 },
  rotationDegrees: 0,
  fontSize: 12,
  score: 1,
});

describe("VisualPreviewExporter", () => {
  it("classifies recovery branches and fallback labels explicitly", () => {
    const organic = {
      id: "branch:p1:0" as SkeletonBranchId,
    } as SkeletonBranch;
    const recovery = {
      id: "layered:p1:0" as SkeletonBranchId,
    } as SkeletonBranch;
    const trunkIds = new Set<string>(["trunk:0"]);

    expect(classifyPreviewBranch(organic, trunkIds)).toBe("ORGANIC");
    expect(classifyPreviewBranch(recovery, trunkIds)).toBe("RECOVERY");
    expect(classifyPreviewLabel(placement("label-candidate:p1:tip:left")))
      .toBe("BRANCH_ATTACHED");
    expect(classifyPreviewLabel(
      placement("label-candidate:p1:fallback:0:24"),
    )).toBe("FALLBACK_LANE");
  });

  it("exports deterministic complete SVG and visual metrics", async () => {
    const template = rectangularTemplate(8_000, 5_000);
    if (template.kind !== "POLYGON") {
      throw new Error("Expected polygon template");
    }
    const { graph, skeletonPlan } = await growSkeleton(
      acceptedSnapshot(),
      template,
    );
    const labelLayout = new LabelLayoutEngine().layout({
      graph,
      skeletonPlan,
      templatePolygon: template.polygon,
      configuration: DEFAULT_ENGINE_CONFIGURATION,
    });
    const exporter = new VisualPreviewExporter();
    const first = await exporter.export({
      graph,
      skeletonPlan,
      labelLayout,
      templatePolygon: template.polygon,
    });
    const replay = await exporter.export({
      graph,
      skeletonPlan: {
        ...skeletonPlan,
        branches: [...skeletonPlan.branches].reverse(),
      },
      labelLayout: {
        ...labelLayout,
        placements: [...labelLayout.placements].reverse(),
      },
      templatePolygon: template.polygon,
    });

    expect(replay).toEqual(first);
    expect(first.metrics.skeletonCoverage).toBe(graph.personsById.size);
    expect(first.metrics.labelCoverage).toBe(graph.personsById.size);
    expect(
      first.metrics.trunkBranchCount +
      first.metrics.organicBranchCount +
      first.metrics.recoveryBranchCount,
    ).toBe(first.metrics.branchCount);
    expect(
      first.metrics.branchAttachedLabelCount +
      first.metrics.fallbackLaneLabelCount,
    ).toBe(first.metrics.labelCoverage);
    expect(first.metrics.minimumLabelFontSize).toBe(
      DEFAULT_ENGINE_CONFIGURATION.labels.minimumFontSize,
    );
    expect(first.metrics.labelDensity).toBeGreaterThan(0);
    expect(first.metrics.branchLengthDistribution.count).toBe(
      skeletonPlan.branches.length,
    );
    expect(() =>
      new XMLParser({ ignoreAttributes: false }).parse(first.svg),
    ).not.toThrow();
    expect(first.svg.match(/data-person-id=/g)).toHaveLength(
      labelLayout.placements.length,
    );
    expect(first.svg).toContain(
      `visual-fingerprint:${first.deterministicFingerprint}`,
    );
  });
});
