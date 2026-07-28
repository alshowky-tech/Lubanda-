import { cubicBezierTangent } from "../geometry/bezier.js";
import { distance } from "../geometry/vec2.js";
import { computeRequiredClearance } from "../routing/ClearanceModel.js";
import type { PersonId } from "../contracts/identifiers.js";
import type { Bounds, Vec2 } from "../geometry/types.js";
import type {
  LabelCandidateGenerationInput,
  LabelCandidate,
  LabelCandidateFamily,
  TextDirection,
  TextMeasureRequest,
  TextMetricsResult,
  GeneratedCandidatesResult,
  LabelDiagnostic,
} from "./types.js";

const DIAGNOSTIC_MAX_WIDTH = 0;
const DIAGNOSTIC_LINE_POLICY = "NATURAL";
const DIAGNOSTIC_MAX_LINES = 100;

const DEFAULT_TERMINAL_SCALE = 1.2;

/**
 * Generate label candidates for each person in a SkeletonPlan.
 */
export class DeterministicLabelCandidateGenerator {
  async generate(input: LabelCandidateGenerationInput): Promise<GeneratedCandidatesResult> {
    const diagnostics: LabelDiagnostic[] = [];
    let seq = 0;
    const allCandidates: LabelCandidate[] = [];
    const personCandidateMap = new Map<PersonId, readonly LabelCandidate[]>();
    let totalGeneratablePeople = 0;

    const { skeletonPlan, graph, nameMap, configuration, cartoucheZones } = input;

    for (const branch of skeletonPlan.branches) {
      if (branch.generation === 0) continue;

      const personId = branch.ownerPersonId;
      const person = branch.metadata.person;
      const isTerminal = graph.isTerminal(personId);
      const nameText = nameMap.get(personId) ?? person.name;

      if (!nameText || nameText.trim().length === 0) {
        diagnostics.push({
          sequence: seq++, stage: "GENERATE_CANDIDATES",
          personId, code: "NO_NAME", message: "Person has no name text",
        });
        continue;
      }

      const direction: TextDirection = "LTR";
      const terminalScale = (configuration as Record<string, unknown>).terminalLabelScale ?? DEFAULT_TERMINAL_SCALE;
      const fontSize = isTerminal
        ? configuration.minimumFontSize * terminalScale
        : configuration.minimumFontSize;

      const measureReq: TextMeasureRequest = {
        text: nameText,
        fontFamily: "DejaVu Sans",
        fontSize,
        fontWeight: 400,
        letterSpacing: 0,
        direction,
        maximumWidth: DIAGNOSTIC_MAX_WIDTH,
        lineCountPolicy: DIAGNOSTIC_LINE_POLICY as "NATURAL",
        maximumLines: DIAGNOSTIC_MAX_LINES,
      };

      let metrics: TextMetricsResult;
      try {
        metrics = await input.textMeasurementService.measure(measureReq);
      } catch {
        diagnostics.push({
          sequence: seq++, stage: "GENERATE_CANDIDATES",
          personId, code: "MEASURE_FAILED", message: "Text measurement failed",
        });
        continue;
      }

      const anchor: Vec2 = branch.endPoint;
      const tangent = cubicBezierTangent(branch.curve, 1);
      const tangentLen = Math.hypot(tangent.x, tangent.y);
      const tangentNorm: Vec2 = tangentLen < 1e-9
        ? { x: 0, y: -1 }
        : { x: tangent.x / tangentLen, y: tangent.y / tangentLen };
      const baseAngle = Math.atan2(tangentNorm.y, tangentNorm.x) * (180 / Math.PI);
      const clampedAngle = Math.max(-configuration.maximumRotationDegrees,
        Math.min(configuration.maximumRotationDegrees, baseAngle));
      const rotation = Math.round(clampedAngle * 100) / 100;

      const branchRadius = branch.thickness.baseThickness;
      const safetyMargin = 4;
      const reqClearance = computeRequiredClearance(branchRadius, branchRadius, safetyMargin, safetyMargin);
      const offsetDist = Math.max(branchRadius + reqClearance, 12);
      const perpDir: Vec2 = { x: -tangentNorm.y, y: tangentNorm.x };

      const textW = metrics.width;
      const textH = metrics.height;
      const candidates: LabelCandidate[] = [];

      // Aligned
      const alignedBounds: Bounds = {
        minX: anchor.x - textW / 2,
        minY: anchor.y - textH / 2,
        maxX: anchor.x + textW / 2,
        maxY: anchor.y + textH / 2,
      };
      candidates.push(this.makeCandidate(personId, alignedBounds, anchor, rotation, 0, "ALIGNED_WITH_BRANCH"));

      // Above
      const aboveAnchor: Vec2 = {
        x: anchor.x + perpDir.x * offsetDist,
        y: anchor.y + perpDir.y * offsetDist,
      };
      const aboveBounds: Bounds = {
        minX: aboveAnchor.x - textW / 2,
        minY: aboveAnchor.y - textH / 2,
        maxX: aboveAnchor.x + textW / 2,
        maxY: aboveAnchor.y + textH / 2,
      };
      candidates.push(this.makeCandidate(personId, aboveBounds, anchor, rotation, distance(anchor, aboveAnchor), "OFFSET_ABOVE_BRANCH"));

      // Below
      const belowAnchor: Vec2 = {
        x: anchor.x - perpDir.x * offsetDist,
        y: anchor.y - perpDir.y * offsetDist,
      };
      const belowBounds: Bounds = {
        minX: belowAnchor.x - textW / 2,
        minY: belowAnchor.y - textH / 2,
        maxX: belowAnchor.x + textW / 2,
        maxY: belowAnchor.y + textH / 2,
      };
      candidates.push(this.makeCandidate(personId, belowBounds, anchor, rotation, distance(anchor, belowAnchor), "OFFSET_BELOW_BRANCH"));

      // Lateral
      const lateralDist = offsetDist * 1.5;
      const lateralDir: Vec2 = tangentNorm.x >= 0
        ? { x: tangentNorm.y, y: -tangentNorm.x }
        : { x: -tangentNorm.y, y: tangentNorm.x };
      const lateralAnchor: Vec2 = {
        x: anchor.x + lateralDir.x * lateralDist,
        y: anchor.y + lateralDir.y * lateralDist,
      };
      const lateralBounds: Bounds = {
        minX: lateralAnchor.x - textW / 2,
        minY: lateralAnchor.y - textH / 2,
        maxX: lateralAnchor.x + textW / 2,
        maxY: lateralAnchor.y + textH / 2,
      };
      candidates.push(this.makeCandidate(personId, lateralBounds, anchor, rotation, distance(anchor, lateralAnchor), "LATERAL"));

      // Terminal leaf
      if (isTerminal) {
        const leafW = textW * terminalScale;
        const leafH = textH * terminalScale;
        const leafBounds: Bounds = {
          minX: anchor.x - leafW / 2,
          minY: anchor.y - leafH / 2,
          maxX: anchor.x + leafW / 2,
          maxY: anchor.y + leafH / 2,
        };
        candidates.push(this.makeCandidate(personId, leafBounds, anchor, rotation, 0, "TERMINAL_LEAF"));
      }

      // Cartouche (only if zones configured)
      if (cartoucheZones && cartoucheZones.length > 0) {
        for (const zone of cartoucheZones) {
          const cartBounds: Bounds = {
            minX: zone.anchor.x - textW / 2,
            minY: zone.anchor.y - textH / 2,
            maxX: zone.anchor.x + textW / 2,
            maxY: zone.anchor.y + textH / 2,
          };
          candidates.push(this.makeCandidate(personId, cartBounds, zone.anchor, 0, distance(anchor, zone.anchor), "CARTOUCHE_ZONE"));
        }
      }

      for (const c of candidates) allCandidates.push(c);
      personCandidateMap.set(personId, Object.freeze(candidates));

      diagnostics.push({
        sequence: seq++, stage: "GENERATE_CANDIDATES",
        personId, code: "CANDIDATES_GENERATED",
        message: `Generated ${candidates.length} candidates`,
        metrics: { candidateCount: candidates.length },
      });

      totalGeneratablePeople += 1;
    }

    return {
      allCandidates: Object.freeze(allCandidates),
      validCandidates: Object.freeze([]),
      personCandidateMap,
      totalGeneratablePeople,
      diagnostics: Object.freeze(diagnostics),
    };
  }

  private makeCandidate(
    personId: PersonId,
    bounds: Bounds,
    anchor: Vec2,
    rotation: number,
    leaderLength: number,
    family: LabelCandidateFamily,
  ): LabelCandidate {
    return Object.freeze({
      personId,
      bounds: Object.freeze({ ...bounds }),
      anchor: Object.freeze({ ...anchor }),
      rotation,
      leaderLength: Math.round(leaderLength * 100) / 100,
      family,
      validationStatus: "VALID" as const,
      rejectionReasons: Object.freeze([]),
      score: null,
      componentScores: undefined as unknown as Readonly<Record<string, number>> | undefined,
    });
  }
}
