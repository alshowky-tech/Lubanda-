import {
  asCorridorId,
  asSkeletonBranchId,
  asSkeletonPlanId,
  type PersonId,
  type SkeletonBranchId,
} from "../contracts/identifiers.js";
import { sha256Canonical } from "../determinism/canonical-json.js";
import { roundDeterministic, stableUnit } from "../determinism/numeric.js";
import { distance, lerp, normalize, subtract } from "../geometry/vec2.js";
import { boundsFromPoints } from "../geometry/bounds.js";
import { evaluateCubicBezier } from "../geometry/bezier.js";
import { classifyPointInPolygon } from "../geometry/polygon.js";
import type { CubicBezier, Vec2, Polygon } from "../geometry/types.js";
import type { Person } from "../genealogy/types.js";
import { buildAttractorField } from "./AttractorField.js";
import { computeBranchThickness } from "./BranchThickness.js";
import {
  generateBranchCandidates,
  scoreBranchCandidates,
  selectBestCandidate,
} from "./CandidateGenerator.js";
import { SkeletonValidator } from "../layout/SkeletonValidator.js";
import type {
  SkeletonGrowthEngine as SkeletonGrowthEngineContract,
  SkeletonGrowthInput,
  SkeletonPlan,
  SkeletonBranch,
  SkeletonNode,
  TrunkSkeleton,
  MappedJunction,
  SkeletonDiagnostic,
  BranchCandidate,
  CandidateGenerationInput,
  CandidateRejectionRecord,
  BranchRejectionReason,
} from "./types.js";

// ── Constants ─────────────────────────────────────────────────────────

const EPSILON = 1e-7;
const TRUNK_UPWARD_DIRECTION: Vec2 = Object.freeze({ x: 0, y: -1 });

// ── Helper: generate sequential IDs ───────────────────────────────────

let globalNodeCounter = 0;
const resetNodeCounter = (seed: number): void => {
  globalNodeCounter = seed & 0xffff;
};
const nextNodeId = (prefix: string): string => {
  globalNodeCounter += 1;
  return `${prefix}:${globalNodeCounter.toString(16)}`;
};

// ── Main growth engine ────────────────────────────────────────────────

export class DeterministicSkeletonGrowthEngine
  implements SkeletonGrowthEngineContract
{
  async grow(input: SkeletonGrowthInput): Promise<SkeletonPlan> {
    resetNodeCounter(input.seed);
    const decimalPlaces = 6;
    const diagnostics: SkeletonDiagnostic[] = [];
    let diagnosticSequence = 0;

    const addDiagnostic = (
      stage: SkeletonDiagnostic["stage"],
      code: string,
      metrics: Readonly<Record<string, number>> = {},
      branchId?: string,
      ownerPersonId?: string,
      rejectionReason?: BranchRejectionReason,
      candidateAttempts?: number,
      acceptedCandidateIndex?: number,
    ): void => {
      diagnostics.push(
        Object.freeze({
          sequence: diagnosticSequence,
          stage,
          code,
          ...(branchId === undefined ? {} : { branchId }),
          ...(ownerPersonId === undefined ? {} : { ownerPersonId }),
          metrics,
          ...(rejectionReason === undefined ? {} : { rejectionReason }),
          ...(candidateAttempts === undefined ? {} : { candidateAttempts }),
          ...(acceptedCandidateIndex === undefined ? {} : { acceptedCandidateIndex }),
        }) as SkeletonDiagnostic,
      );
      diagnosticSequence += 1;
    };

    // ── Validate input ──
    if (!input.graph.personsById.has(input.selectedRootId)) {
      throw new RangeError(`Unknown skeleton root: ${input.selectedRootId}`);
    }
    const territoryPlan = input.territoryPlan;
    if (territoryPlan.status !== "ACCEPTED") {
      throw new TypeError("Skeleton growth requires an accepted territory plan");
    }

    input.diagnostics?.emit({
      stage: "GROW_SKELETON",
      eventType: "STAGE_START",
      entityId: input.selectedRootId,
    });

    // ── Gather data ──
    const templatePolygon = territoryPlan.templatePolygon;
    const rootEntry = territoryPlan.rootEntryReservation;
    const territories = territoryPlan.territories;
    const corridors = territoryPlan.corridors;
    const junctionZones = territoryPlan.junctionZones;

    // Build territory lookup by owner
    const territoryByOwner = new Map<PersonId, (typeof territories)[number]>();
    for (const t of territories) {
      territoryByOwner.set(t.ownerLineageRootId, t);
    }

    // Build corridor lookup by owner
    const corridorByOwner = new Map<PersonId, (typeof corridors)[number]>();
    for (const c of corridors) {
      corridorByOwner.set(c.ownerLineageRootId, c);
    }

    // Build attractor field
    const bounds = boundsFromPoints(templatePolygon.points);
    const attractorField = buildAttractorField(
      rootEntry.center,
      { x: bounds.minX, y: bounds.minY },
      { x: bounds.maxX, y: bounds.maxY },
      territories.map((t) => t.centroid),
      input.seed,
    );

    // ── Phase 1: Trunk centerline ──
    addDiagnostic("TRUNK_PLANNING", "TRUNK_START", {
      junctionZoneCount: junctionZones.length,
    });

    const nodes = new Map<string, SkeletonNode>();
    const branches = new Map<string, SkeletonBranch>();
    const allBranchGeometry: Array<{
      readonly id: SkeletonBranchId;
      readonly curve: CubicBezier;
    }> = [];
    const mappedJunctions: MappedJunction[] = [];
    let totalInvalidCandidates = 0;
    let totalRejectedCandidates = 0;

    // Create trunk base node at root entry center
    const trunkBaseNodeId = nextNodeId("trunk-base");
    const trunkBase: SkeletonNode = {
      id: trunkBaseNodeId,
      point: { x: rootEntry.center.x, y: rootEntry.center.y },
      kind: "TRUNK_BASE",
      incomingBranchId: null,
      outgoingBranchIds: [],
      ownerLineageRootId: input.selectedRootId,
    };
    nodes.set(trunkBaseNodeId, trunkBase);

    addDiagnostic("TRUNK_PLANNING", "TRUNK_BASE_PLACED", {
      x: roundDeterministic(trunkBase.point.x, decimalPlaces),
      y: roundDeterministic(trunkBase.point.y, decimalPlaces),
    });

    // Sort junctions by their position along the Y axis (upward = lower Y)
    const sortedJunctions = [...junctionZones].sort(
      (a, b) => a.center.y - b.center.y,
    );

    // Build trunk segments through junction zones
    const trunkSegmentIds: SkeletonBranchId[] = [];
    let previousTrunkNodeId = trunkBaseNodeId;
    let previousTrunkPoint = trunkBase.point;

    for (let jzIndex = 0; jzIndex < sortedJunctions.length; jzIndex += 1) {
      const junction = sortedJunctions[jzIndex]!;
      const trunkJunctionPoint: Vec2 = {
        x: junction.center.x,
        y: junction.center.y,
      };

      if (classifyPointInPolygon(trunkJunctionPoint, templatePolygon) === "OUTSIDE") {
        addDiagnostic("TRUNK_PLANNING", "JUNCTION_OUT_OF_BOUNDS", {
          junctionIndex: jzIndex,
        });
        continue;
      }

      const prevJunctionX = jzIndex > 0
        ? (sortedJunctions[jzIndex - 1]?.center.x ?? 0)
        : 0;
      const trunkSegmentCurve: CubicBezier = {
        p0: previousTrunkPoint,
        p1: {
          x: lerp(previousTrunkPoint, trunkJunctionPoint, 0.25).x + prevJunctionX * 0.02,
          y: lerp(previousTrunkPoint, trunkJunctionPoint, 0.25).y,
        },
        p2: {
          x: lerp(previousTrunkPoint, trunkJunctionPoint, 0.75).x + prevJunctionX * 0.02,
          y: lerp(previousTrunkPoint, trunkJunctionPoint, 0.75).y,
        },
        p3: trunkJunctionPoint,
      };

      const trunkNodeId = nextNodeId("trunk-junction");
      const trunkNode: SkeletonNode = {
        id: trunkNodeId,
        point: trunkJunctionPoint,
        kind: "TRUNK_JUNCTION",
        incomingBranchId: null,
        outgoingBranchIds: [],
        ownerLineageRootId: input.selectedRootId,
      };
      nodes.set(trunkNodeId, trunkNode);

      const trunkSegmentLength = distance(previousTrunkPoint, trunkJunctionPoint);
      const trunkBranchId = asSkeletonBranchId(`trunk:${previousTrunkNodeId}:${trunkNodeId}`);
      const trunkBranch: SkeletonBranch = {
        id: trunkBranchId,
        ownerPersonId: input.selectedRootId,
        parentBranchId: null,
        generation: 0,
        genealogyDepth: 0,
        territoryId: null,
        curve: trunkSegmentCurve,
        startPoint: previousTrunkPoint,
        endPoint: trunkJunctionPoint,
        length: roundDeterministic(trunkSegmentLength, decimalPlaces),
        thickness: computeBranchThickness(
          input.graph.getSubtree(input.selectedRootId).length,
          input.graph.getSubtree(input.selectedRootId).length,
          null,
          true,
          0,
        ),
        startNodeId: previousTrunkNodeId,
        endNodeId: trunkNodeId,
        childrenBranchIds: [],
        candidateScore: null,
        rejectionHistory: [],
        metadata: Object.freeze({
          branchIndex: branches.size,
          lineageRootId: input.selectedRootId,
          person: input.graph.personsById.get(input.selectedRootId) as Person,
        }),
      };
      branches.set(trunkBranchId, trunkBranch);
      trunkSegmentIds.push(trunkBranchId);

      const prevNode = nodes.get(previousTrunkNodeId)!;
      nodes.set(previousTrunkNodeId, {
        ...prevNode,
        outgoingBranchIds: Object.freeze([...prevNode.outgoingBranchIds, trunkBranchId]),
      });
      nodes.set(trunkNodeId, {
        ...trunkNode,
        incomingBranchId: trunkBranchId,
      });

      const corridor = corridorByOwner.get(junction.ownerLineageRootId);
      mappedJunctions.push({
        junctionZoneId: junction.id,
        trunkNodeId,
        lineageRootId: junction.ownerLineageRootId,
        trunkPoint: trunkJunctionPoint,
        corridorId: corridor?.id ?? asCorridorId("corridor:none"),
      });

      previousTrunkNodeId = trunkNodeId;
      previousTrunkPoint = trunkJunctionPoint;

      addDiagnostic("TRUNK_PLANNING", "TRUNK_SEGMENT_ADDED", {
        segmentIndex: trunkSegmentIds.length - 1,
        length: roundDeterministic(trunkSegmentLength, decimalPlaces),
        junctionY: roundDeterministic(trunkJunctionPoint.y, decimalPlaces),
      });
    }

    // Create trunk terminal node
    const trunkTerminalNodeId = nextNodeId("trunk-terminal");
    const trunkTerminalPoint: Vec2 = {
      x: previousTrunkPoint.x,
      y: previousTrunkPoint.y - distance(previousTrunkPoint, { x: previousTrunkPoint.x, y: bounds.minY }) * 0.15,
    };
    const clampedTerminal = classifyPointInPolygon(trunkTerminalPoint, templatePolygon) === "OUTSIDE"
      ? previousTrunkPoint
      : trunkTerminalPoint;

    if (distance(previousTrunkPoint, clampedTerminal) > EPSILON) {
      const finalCurve: CubicBezier = {
        p0: previousTrunkPoint,
        p1: lerp(previousTrunkPoint, clampedTerminal, 0.33),
        p2: lerp(previousTrunkPoint, clampedTerminal, 0.66),
        p3: clampedTerminal,
      };
      const terminalNode: SkeletonNode = {
        id: trunkTerminalNodeId,
        point: clampedTerminal,
        kind: "TRUNK_TERMINAL",
        incomingBranchId: null,
        outgoingBranchIds: [],
        ownerLineageRootId: input.selectedRootId,
      };
      nodes.set(trunkTerminalNodeId, terminalNode);

      const finalLength = distance(previousTrunkPoint, clampedTerminal);
      const finalBranchId = asSkeletonBranchId(`trunk:${previousTrunkNodeId}:${trunkTerminalNodeId}`);
      const finalBranch: SkeletonBranch = {
        id: finalBranchId,
        ownerPersonId: input.selectedRootId,
        parentBranchId: null,
        generation: 0,
        genealogyDepth: 0,
        territoryId: null,
        curve: finalCurve,
        startPoint: previousTrunkPoint,
        endPoint: clampedTerminal,
        length: roundDeterministic(finalLength, decimalPlaces),
        thickness: computeBranchThickness(
          input.graph.getSubtree(input.selectedRootId).length,
          input.graph.getSubtree(input.selectedRootId).length,
          null,
          true,
          sortedJunctions.length,
        ),
        startNodeId: previousTrunkNodeId,
        endNodeId: trunkTerminalNodeId,
        childrenBranchIds: [],
        candidateScore: null,
        rejectionHistory: [],
        metadata: Object.freeze({
          branchIndex: branches.size,
          lineageRootId: input.selectedRootId,
          person: input.graph.personsById.get(input.selectedRootId) as Person,
        }),
      };
      branches.set(finalBranchId, finalBranch);
      trunkSegmentIds.push(finalBranchId);

      const prevNode = nodes.get(previousTrunkNodeId)!;
      nodes.set(previousTrunkNodeId, {
        ...prevNode,
        outgoingBranchIds: Object.freeze([...prevNode.outgoingBranchIds, finalBranchId]),
      });
      nodes.set(trunkTerminalNodeId, {
        ...terminalNode,
        incomingBranchId: finalBranchId,
      });
    } else {
      const lastJunctionNode = nodes.get(previousTrunkNodeId)!;
      nodes.set(previousTrunkNodeId, {
        ...lastJunctionNode,
        kind: "TRUNK_TERMINAL",
      });
    }

    // Build trunk skeleton
    const trunk: TrunkSkeleton = {
      baseNodeId: trunkBaseNodeId,
      terminalNodeId: trunkTerminalNodeId,
      segments: Object.freeze(trunkSegmentIds),
      length: roundDeterministic(
        trunkSegmentIds.reduce((sum, id) => sum + (branches.get(id)?.length ?? 0), 0),
        decimalPlaces,
      ),
      centroid: {
        x: bounds.minX + (bounds.maxX - bounds.minX) / 2,
        y: trunkBase.point.y,
      },
    };

    addDiagnostic("TRUNK_PLANNING", "TRUNK_COMPLETE", {
      segmentCount: trunkSegmentIds.length,
      totalLength: trunk.length,
    });

    // ── Phase 2: Junction planning ──
    addDiagnostic("JUNCTION_PLANNING", "JUNCTION_PLANNING_START", {
      mappedJunctionCount: mappedJunctions.length,
    });

    // ── Phase 3: Recursive skeleton growth ──
    // Returns true if all branches were grown successfully, false if any
    // person had no valid candidate (hard failure).

    let growthFailed = false;
    let growthFailurePersonId: PersonId | null = null;

    const growBranchRecursive = (
      personId: PersonId,
      parentBranchId: SkeletonBranchId | null,
      startPoint: Vec2,
      startNodeId: string,
      parentDirection: Vec2 | null,
      genealogyDepth: number,
      skeletonDepth: number,
      existingBranches: Array<{
        readonly id: SkeletonBranchId;
        readonly curve: CubicBezier;
      }>,
    ): { branch: SkeletonBranch | null; endNodeId: string | null } => {
      const person = input.graph.personsById.get(personId);
      if (!person) return { branch: null, endNodeId: null };

      const children = input.graph.childrenByParentId.get(personId) ?? [];
      const territory = territoryByOwner.get(personId);

      // Determine endPoint
      let endPoint: Vec2;
      if (territory) {
        endPoint = { x: territory.centroid.x, y: territory.centroid.y };
      } else if (children.length > 0) {
        const firstChild = children[0]!;
        const childTerritory = territoryByOwner.get(firstChild);
        if (childTerritory) {
          endPoint = { x: childTerritory.centroid.x, y: childTerritory.centroid.y };
        } else {
          const dir = parentDirection ?? TRUNK_UPWARD_DIRECTION;
          const extend = Math.max(
            input.configuration.minimumBranchLength * 3,
            120 + genealogyDepth * 20,
          );
          endPoint = { x: startPoint.x + dir.x * extend, y: startPoint.y + dir.y * extend };
        }
      } else {
        const dir = parentDirection ?? TRUNK_UPWARD_DIRECTION;
        const extend = Math.max(
          input.configuration.minimumBranchLength * 3,
          60 + genealogyDepth * 15,
        );
        endPoint = { x: startPoint.x + dir.x * extend, y: startPoint.y + dir.y * extend };
      }

      // Clamp endpoint to template
      if (classifyPointInPolygon(endPoint, templatePolygon) === "OUTSIDE") {
        endPoint = {
          x: Math.max(bounds.minX + 10, Math.min(bounds.maxX - 10, endPoint.x)),
          y: Math.max(bounds.minY + 10, Math.min(bounds.maxY - 10, endPoint.y)),
        };
      }

      const toEnd = subtract(endPoint, startPoint);
      const toEndLen = Math.hypot(toEnd.x, toEnd.y);
      let direction = toEndLen > EPSILON
        ? normalize(toEnd)
        : parentDirection ?? TRUNK_UPWARD_DIRECTION;

      // Generate and evaluate candidates. If a fixed endpoint traps every
      // candidate, sweep deterministic alternate directions while preserving
      // all hard geometry checks.
      const territoryPolygon = territory?.polygon ?? null;
      // Major lineage branches (parentBranchId === null) start at trunk junctions
      // which may be outside the territory. Use relaxed check for those.
      const relaxedTerritory = parentBranchId === null;
      const directionOffsets = territory === undefined
        ? [0, 18, -18, 36, -36, 54, -54, 72, -72, 90, -90, 120, -120, 150, -150, 180]
        : [0];
      const attemptedCandidates: BranchCandidate[] = [];
      let selected: BranchCandidate | null = null;
      let acceptedCandidateIndex: number | null = null;
      const branchDistance = Math.max(
        toEndLen,
        input.configuration.minimumBranchLength * 3,
      );
      for (
        let directionAttempt = 0;
        directionAttempt < directionOffsets.length && selected === null;
        directionAttempt += 1
      ) {
        const angle = (directionOffsets[directionAttempt] as number) * Math.PI / 180;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const attemptDirection = {
          x: direction.x * cos - direction.y * sin,
          y: direction.x * sin + direction.y * cos,
        };
        const rawAttemptEnd = directionAttempt === 0
          ? endPoint
          : {
              x: startPoint.x + attemptDirection.x * branchDistance,
              y: startPoint.y + attemptDirection.y * branchDistance,
            };
        const attemptEnd = classifyPointInPolygon(rawAttemptEnd, templatePolygon) === "OUTSIDE"
          ? {
              x: Math.max(bounds.minX + 10, Math.min(bounds.maxX - 10, rawAttemptEnd.x)),
              y: Math.max(bounds.minY + 10, Math.min(bounds.maxY - 10, rawAttemptEnd.y)),
            }
          : rawAttemptEnd;
        const candidateInput: CandidateGenerationInput = {
          startPoint,
          endPoint: attemptEnd,
          startDirection: parentDirection ?? TRUNK_UPWARD_DIRECTION,
          ownerPersonId: personId,
          territoryPolygon,
          templatePolygon,
          attractors: attractorField,
          config: input.configuration,
          seed:
            input.seed +
            skeletonDepth * 13 +
            branches.size * 7 +
            directionAttempt * 997,
          existingBranches,
          ignoredBranchIds:
            parentBranchId === null ? [] : [parentBranchId],
          relaxedTerritoryCheck: relaxedTerritory,
          candidateCount: input.configuration.candidateCount,
          genealogyDepth,
          roundingDecimalPlaces: decimalPlaces,
        };
        const candidates = generateBranchCandidates(candidateInput);
        const indexOffset = attemptedCandidates.length;
        const scored = scoreBranchCandidates(
          candidates,
          parentDirection ?? TRUNK_UPWARD_DIRECTION,
          attractorField,
          input.seed + skeletonDepth * 17 + directionAttempt * 997,
        ).map((candidate) => ({
          ...candidate,
          index: candidate.index + indexOffset,
        }));
        attemptedCandidates.push(...scored);
        selected = selectBestCandidate(scored);
        if (selected !== null) {
          endPoint = selected.endPoint;
          direction = normalize(subtract(endPoint, startPoint));
          acceptedCandidateIndex = selected.index;
        }
      }

      const rejectionHistory: CandidateRejectionRecord[] = [];
      for (const c of attemptedCandidates) {
        if (!c.valid) {
          for (const reason of c.rejectionReasons) {
            rejectionHistory.push({ candidateIndex: c.index, reason });
          }
        }
      }
      totalInvalidCandidates += attemptedCandidates.filter((c) => !c.valid).length;
      totalRejectedCandidates += attemptedCandidates.filter(
        (c) => c.valid && c.index !== selected?.index,
      ).length;

      // 💥 Correction 1: Hard candidate rejection — no fallback branch
      if (!selected) {
        const rejectionCounts = attemptedCandidates.reduce<Record<string, number>>(
          (counts, candidate) => {
            for (const reason of candidate.rejectionReasons) {
              counts[reason] = (counts[reason] ?? 0) + 1;
            }
            return counts;
          },
          {},
        );
        addDiagnostic(
          "RECURSIVE_GROWTH",
          "NO_VALID_CANDIDATE",
          { candidateCount: attemptedCandidates.length, ...rejectionCounts },
          undefined,
          personId,
          "NO_VALID_CANDIDATE",
          attemptedCandidates.length,
        );
        growthFailed = true;
        growthFailurePersonId = personId;
        return { branch: null, endNodeId: null };
      }

      const branchCurve = selected.curve;
      const branchLength = selected.length;
      const branchId = asSkeletonBranchId(`branch:${personId}:${branches.size}`);

      // Create end node
      const branchEndNodeId = nextNodeId("branch-node");
      const endNode: SkeletonNode = {
        id: branchEndNodeId,
        point: endPoint,
        kind: children.length === 0 ? "BRANCH_TERMINAL" : "BRANCH_SPLIT",
        incomingBranchId: branchId,
        outgoingBranchIds: [],
        ownerLineageRootId: personId,
      };
      nodes.set(branchEndNodeId, endNode);

      // If parentBranchId is null, this is a major lineage branch starting at a trunk junction.
      // Use startNodeId directly (caller provides the exact trunk junction node).
      // Otherwise, look up the parent branch's end node.
      const effectiveStartNodeId = startNodeId;

      const branch: SkeletonBranch = {
        id: branchId,
        ownerPersonId: personId,
        parentBranchId,
        generation: skeletonDepth,
        genealogyDepth,
        territoryId: territory?.id ?? null,
        curve: branchCurve,
        startPoint,
        endPoint,
        length: roundDeterministic(branchLength, decimalPlaces),
        thickness: computeBranchThickness(
          input.graph.getSubtree(personId).length,
          input.graph.getSubtree(input.selectedRootId).length,
          null,
          false,
          genealogyDepth,
        ),
        startNodeId: effectiveStartNodeId,
        endNodeId: branchEndNodeId,
        childrenBranchIds: [],
        candidateScore: selected.score ?? null,
        rejectionHistory: Object.freeze(rejectionHistory),
        metadata: Object.freeze({
          branchIndex: branches.size,
          lineageRootId: personId,
          person,
        }),
      };
      branches.set(branchId, branch);
      allBranchGeometry.push({ id: branch.id, curve: branch.curve });

      addDiagnostic(
        "RECURSIVE_GROWTH",
        "BRANCH_GROWN",
        {
          length: branch.length,
          score: selected.score ?? 0,
          candidateCount: attemptedCandidates.length,
          validCount: attemptedCandidates.filter((c) => c.valid).length,
        },
        branchId,
        personId,
        undefined,
        attemptedCandidates.length,
        acceptedCandidateIndex ?? 0,
      );

      // 💥 Correction 4: Create real BRANCH_SPLIT nodes for children
      const childDirections = generateChildDirections(
        direction,
        children.length,
        input.seed + personId.charCodeAt(0) + branches.size,
      );
      const childBranchIds: SkeletonBranchId[] = [];

      for (let childIndex = 0; childIndex < children.length; childIndex += 1) {
        const childId = children[childIndex]!;
        const childDir = childDirections[childIndex] ?? direction;

        // If the child starts at an interior point of this branch, create
        // a real BRANCH_SPLIT node. Otherwise start from our end node.
        let childStartNodeId: string;
        let childStartPoint: Vec2;

        if (children.length > 1) {
          // Multiple children — create split nodes at distributed positions
          const t = 0.55 + (childIndex / Math.max(1, children.length)) * 0.4;
          childStartPoint = evaluateCubicBezier(branch.curve, t);
          const splitNodeId = nextNodeId("branch-split");
          const splitNode: SkeletonNode = {
            id: splitNodeId,
            point: childStartPoint,
            kind: "BRANCH_SPLIT",
            incomingBranchId: null,
            outgoingBranchIds: [],
            ownerLineageRootId: personId,
          };
          nodes.set(splitNodeId, splitNode);
          childStartNodeId = splitNodeId;
        } else {
          // Single child — use the parent's end node
          childStartPoint = endPoint;
          childStartNodeId = branchEndNodeId;
        }

        // For children, skip parent chain bounds from intersection check
        const result = growBranchRecursive(
          childId,
          branchId,
          childStartPoint,
          childStartNodeId,
          childDir,
          genealogyDepth + 1,
          skeletonDepth + 1,
          allBranchGeometry,
        );
        if (result.branch) {
          childBranchIds.push(result.branch.id);
        }
        // If growthFailed is set, stop recursing
        if (growthFailed) break;
      }

      if (childBranchIds.length > 0) {
        branches.set(branchId, {
          ...branch,
          childrenBranchIds: Object.freeze(childBranchIds),
        });
      }

      // Update parent node connections
      const parentNode = nodes.get(effectiveStartNodeId);
      if (parentNode) {
        nodes.set(effectiveStartNodeId, {
          ...parentNode,
          outgoingBranchIds: Object.freeze([
            ...parentNode.outgoingBranchIds,
            branchId,
          ]),
        });
      }

      return { branch, endNodeId: branchEndNodeId };
    };

    // Grow major lineage branches from their trunk junction points
    // 💥 Correction 3: Use exact trunk junction nodeId as startNodeId
    for (const mj of mappedJunctions) {
      const territory = territoryByOwner.get(mj.lineageRootId);
      if (!territory) continue;

      if (growthFailed) break;

      addDiagnostic("RECURSIVE_GROWTH", "LINEAGE_GROWTH_START", {}, undefined, mj.lineageRootId);

      const branchPoint = mj.trunkPoint;
      const targetPoint = territory.centroid;
      const toTerritory = subtract(targetPoint, branchPoint);
      const toTerritoryLen = Math.hypot(toTerritory.x, toTerritory.y);
      const lineageDirection = toTerritoryLen > EPSILON
        ? normalize(toTerritory)
        : { x: 0.2, y: -0.8 };

      growBranchRecursive(
        mj.lineageRootId,
        null,
        branchPoint,
        mj.trunkNodeId,  // 💥 Exact trunk junction node
        lineageDirection,
        1,
        1,
        allBranchGeometry,
      );
    }

    // ── Deterministic recovery for a locally trapped greedy solve ──
    if (growthFailed) {
      addDiagnostic(
        "SKELETON_VALIDATION",
        "LAYERED_RECOVERY_START",
        {
          partialBranchCount: branches.size,
          totalInvalidCandidates,
          totalRejectedCandidates,
        },
        undefined,
        growthFailurePersonId ?? undefined,
        "NO_VALID_CANDIDATE",
      );

      const trunkBranchIds = new Set<SkeletonBranchId>(trunk.segments);
      const recoveredBranches = new Map<SkeletonBranchId, SkeletonBranch>();
      for (const branchId of trunk.segments) {
        const branch = branches.get(branchId);
        if (branch) recoveredBranches.set(branchId, branch);
      }
      const recoveredNodes = new Map<string, SkeletonNode>();
      for (const node of nodes.values()) {
        if (!node.kind.startsWith("TRUNK")) continue;
        recoveredNodes.set(node.id, {
          ...node,
          incomingBranchId:
            node.incomingBranchId !== null &&
            trunkBranchIds.has(node.incomingBranchId)
              ? node.incomingBranchId
              : null,
          outgoingBranchIds: Object.freeze(
            node.outgoingBranchIds.filter((id) => trunkBranchIds.has(id)),
          ),
        });
      }

      const depthByPerson = new Map<PersonId, number>([
        [input.selectedRootId, 0],
      ]);
      const lineageRootByPerson = new Map<PersonId, PersonId>();
      const majorLineageIds =
        input.graph.childrenByParentId.get(input.selectedRootId) ?? [];
      for (const lineageRootId of majorLineageIds) {
        const stack: Array<{ readonly id: PersonId; readonly depth: number }> = [
          { id: lineageRootId, depth: 1 },
        ];
        while (stack.length > 0) {
          const current = stack.pop() as {
            readonly id: PersonId;
            readonly depth: number;
          };
          depthByPerson.set(current.id, current.depth);
          lineageRootByPerson.set(current.id, lineageRootId);
          const children = input.graph.childrenByParentId.get(current.id) ?? [];
          for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push({
              id: children[index] as PersonId,
              depth: current.depth + 1,
            });
          }
        }
      }

      const positionByPerson = new Map<PersonId, Vec2>();
      const orderedLineages = [...majorLineageIds]
        .filter((id) => territoryByOwner.has(id))
        .sort((left, right) => {
          const leftX = territoryByOwner.get(left)?.centroid.x ?? 0;
          const rightX = territoryByOwner.get(right)?.centroid.x ?? 0;
          return leftX - rightX || left.localeCompare(right);
        });
      const lineageBandById = new Map<
        PersonId,
        Readonly<{ readonly left: number; readonly right: number }>
      >();
      for (let index = 0; index < orderedLineages.length; index += 1) {
        const currentId = orderedLineages[index] as PersonId;
        const currentX =
          territoryByOwner.get(currentId)?.centroid.x ??
          (bounds.minX + bounds.maxX) / 2;
        const previousId = orderedLineages[index - 1];
        const nextId = orderedLineages[index + 1];
        const previousBoundary =
          previousId === undefined
            ? bounds.minX + 32
            : ((territoryByOwner.get(previousId)?.centroid.x ?? currentX) +
                currentX) /
                2 +
              16;
        const nextBoundary =
          nextId === undefined
            ? bounds.maxX - 32
            : (currentX +
                (territoryByOwner.get(nextId)?.centroid.x ?? currentX)) /
                2 -
              16;
        lineageBandById.set(currentId, {
          left: previousBoundary,
          right: nextBoundary,
        });
      }
      for (const lineageRootId of majorLineageIds) {
        const territory = territoryByOwner.get(lineageRootId);
        if (!territory) continue;
        const subtree = input.graph.getSubtree(lineageRootId);
        const terminalIds = subtree.filter((id) => input.graph.isTerminal(id));
        const lineageBand = lineageBandById.get(lineageRootId);
        const left = lineageBand?.left ?? territory.centroid.x;
        const right = lineageBand?.right ?? territory.centroid.x;
        const terminalX = new Map<PersonId, number>();
        terminalIds.forEach((id, index) => {
          const ratio =
            terminalIds.length <= 1 ? 0.5 : index / (terminalIds.length - 1);
          terminalX.set(
            id,
            right > left
              ? left + (right - left) * ratio
              : territory.centroid.x,
          );
        });
        const xByPerson = new Map<PersonId, number>();
        const resolveX = (personId: PersonId): number => {
          const cached = xByPerson.get(personId);
          if (cached !== undefined) return cached;
          const children =
            input.graph.childrenByParentId.get(personId) ?? [];
          if (children.length === 0) {
            const value = terminalX.get(personId) ?? territory.centroid.x;
            xByPerson.set(personId, value);
            return value;
          }
          const childX = children.map(resolveX);
          const value =
            (Math.min(...childX) + Math.max(...childX)) / 2;
          xByPerson.set(personId, value);
          return value;
        };
        resolveX(lineageRootId);

        const maximumDepth = Math.max(
          ...subtree.map((id) => depthByPerson.get(id) ?? 1),
          1,
        );
        const lineageStartY = territory.centroid.y;
        const bottomY = bounds.maxY - 48;
        const availableDepth = Math.max(1, maximumDepth - 1);
        for (const personId of subtree) {
          const depth = depthByPerson.get(personId) ?? 1;
          const relativeDepth = depth - 1;
          positionByPerson.set(
            personId,
            depth === 1
              ? { ...territory.centroid }
              : {
                  x: resolveX(personId),
                  y:
                    lineageStartY +
                    (bottomY - lineageStartY) *
                      (relativeDepth / availableDepth),
                },
          );
        }
      }

      const branchIdByPerson = new Map<PersonId, SkeletonBranchId>();
      const nodeIdByPerson = new Map<PersonId, string>();
      const demandByPerson = new Map(
        input.demandPlan.results.map((entry) => [
          entry.personId,
          entry,
        ] as const),
      );

      for (const lineageRootId of majorLineageIds) {
        const mappedJunction = mappedJunctions.find(
          (entry) => entry.lineageRootId === lineageRootId,
        );
        if (!mappedJunction) continue;
        const stack: PersonId[] = [lineageRootId];
        while (stack.length > 0) {
          const personId = stack.pop() as PersonId;
          const person = input.graph.personsById.get(personId);
          const endPoint = positionByPerson.get(personId);
          if (!person || !endPoint) continue;
          const parentId = person.parentId;
          const parentBranchId =
            parentId === input.selectedRootId
              ? null
              : branchIdByPerson.get(parentId as PersonId) ?? null;
          const startNodeId =
            parentId === input.selectedRootId
              ? mappedJunction.trunkNodeId
              : nodeIdByPerson.get(parentId as PersonId);
          if (!startNodeId) continue;
          const startNode = recoveredNodes.get(startNodeId);
          if (!startNode) continue;
          const startPoint = startNode.point;
          const branchIndex = recoveredBranches.size;
          const branchId = asSkeletonBranchId(
            `layered:${personId}:${branchIndex}`,
          );
          const endNodeId = nextNodeId("layered-node");
          const children =
            input.graph.childrenByParentId.get(personId) ?? [];
          const lineageRoot =
            lineageRootByPerson.get(personId) ?? lineageRootId;
          const depth = depthByPerson.get(personId) ?? 1;
          const subtreeSize =
            (demandByPerson.get(personId)?.raw.descendantCount ?? 0) + 1;
          const endNode: SkeletonNode = {
            id: endNodeId,
            point: endPoint,
            kind:
              children.length === 0 ? "BRANCH_TERMINAL" : "BRANCH_SPLIT",
            incomingBranchId: branchId,
            outgoingBranchIds: Object.freeze([]),
            ownerLineageRootId: lineageRoot,
          };
          recoveredNodes.set(endNodeId, endNode);
          const curve: CubicBezier = {
            p0: { ...startPoint },
            p1: lerp(startPoint, endPoint, 1 / 3),
            p2: lerp(startPoint, endPoint, 2 / 3),
            p3: { ...endPoint },
          };
          const majorTerritory =
            parentId === input.selectedRootId
              ? territoryByOwner.get(personId)
              : undefined;
          const branch: SkeletonBranch = {
            id: branchId,
            ownerPersonId: personId,
            parentBranchId,
            generation: depth,
            genealogyDepth: depth,
            territoryId: majorTerritory?.id ?? null,
            curve,
            startPoint: { ...startPoint },
            endPoint: { ...endPoint },
            length: roundDeterministic(
              distance(startPoint, endPoint),
              decimalPlaces,
            ),
            thickness: computeBranchThickness(
              subtreeSize,
              input.graph.getSubtree(input.selectedRootId).length,
              null,
              false,
              depth,
            ),
            startNodeId,
            endNodeId,
            childrenBranchIds: Object.freeze([]),
            candidateScore: null,
            rejectionHistory: Object.freeze([]),
            metadata: Object.freeze({
              branchIndex,
              lineageRootId: lineageRoot,
              person,
            }),
          };
          recoveredBranches.set(branchId, branch);
          branchIdByPerson.set(personId, branchId);
          nodeIdByPerson.set(personId, endNodeId);
          recoveredNodes.set(startNodeId, {
            ...startNode,
            outgoingBranchIds: Object.freeze([
              ...startNode.outgoingBranchIds,
              branchId,
            ]),
          });
          if (parentBranchId !== null) {
            const parentBranch = recoveredBranches.get(parentBranchId);
            if (parentBranch) {
              recoveredBranches.set(parentBranchId, {
                ...parentBranch,
                childrenBranchIds: Object.freeze([
                  ...parentBranch.childrenBranchIds,
                  branchId,
                ]),
              });
            }
          }
          for (let index = children.length - 1; index >= 0; index -= 1) {
            stack.push(children[index] as PersonId);
          }
        }
      }

      branches.clear();
      for (const [id, branch] of recoveredBranches) branches.set(id, branch);
      nodes.clear();
      for (const [id, node] of recoveredNodes) nodes.set(id, node);
      allBranchGeometry.length = 0;
      for (const branch of recoveredBranches.values()) {
        allBranchGeometry.push({ id: branch.id, curve: branch.curve });
      }
      growthFailed = false;
      addDiagnostic("SKELETON_VALIDATION", "LAYERED_RECOVERY_COMPLETE", {
        recoveredBranchCount: recoveredBranches.size,
        recoveredNodeCount: recoveredNodes.size,
        coveredPersonCount: new Set(
          [...recoveredBranches.values()].map(
            (branch) => branch.ownerPersonId,
          ),
        ).size,
      });
    }

    // ── Run SkeletonValidator before declaring accepted ──
    // 💥 Correction 2: Use real validator
    addDiagnostic("SKELETON_VALIDATION", "VALIDATION_START", {
      branchCount: branches.size,
      nodeCount: nodes.size,
    });

    const allBranches = [...branches.values()];
    const allNodes = [...nodes.values()];

    // Build territory polygon map by TerritoryId
    const territoryPolyMap = new Map<string, Polygon>();
    for (const t of territories) {
      territoryPolyMap.set(t.id, t.polygon);
    }

    const validator = new SkeletonValidator();
    const validationResult = validator.validate(
      {
        schemaVersion: "1.0",
        engineVersion: "0.2.0",
        skeletonPlanId: asSkeletonPlanId("placeholder"),
        status: "ACCEPTED",
        selectedRootId: input.selectedRootId,
        sourceChecksum: input.sourceChecksum,
        seed: input.seed,
        territoryPlanFingerprint: territoryPlan.deterministicFingerprint,
        trunk,
        branches: Object.freeze(allBranches),
        nodes: Object.freeze(allNodes),
        mappedJunctions: Object.freeze(mappedJunctions),
        diagnostics: Object.freeze(diagnostics),
        validation: Object.freeze({
          accepted: true,
          issues: Object.freeze([]),
          metrics: {
            branchCount: 0,
            nodeCount: 0,
            trunkSegmentCount: 0,
            junctionCount: 0,
            invalidBranchCount: 0,
            missingPersonBranchCount: 0,
            orphanBranchCount: 0,
            territoryMissCount: 0,
            outOfBoundsCount: 0,
            intersectionCount: 0,
            totalCurveLength: 0,
            maxDepth: 0,
            acceptedPersonCount: 0,
            connectedPersonCount: 0,
          },
        }),
        configurationUsed: input.configuration,
        metadata: Object.freeze({
          algorithm: "RECURSIVE_ORGANIC_GROWTH",
          branchCount: 0,
          nodeCount: 0,
          maximumGenealogyDepth: 0,
          maximumSkeletonDepth: 0,
          totalInvalidCandidateCount: 0,
          totalRejectedCandidateCount: 0,
        }),
        deterministicFingerprint: "",
      },
      input.graph,
      input.selectedRootId,
      templatePolygon,
      territoryPolyMap,
    );

    const maxDepth = Math.max(...allBranches.map((b) => b.genealogyDepth), 0);
    const finalBranchCount = allBranches.length;
    const planStatus = validationResult.accepted ? "ACCEPTED" as const : "REJECTED" as const;

    // Generate deterministic fingerprint
    const fingerprintInput = {
      selectedRootId: input.selectedRootId,
      sourceChecksum: input.sourceChecksum,
      seed: input.seed,
      territoryPlanFingerprint: territoryPlan.deterministicFingerprint,
      trunk,
      branches: allBranches.map((b) => ({
        id: b.id,
        ownerPersonId: b.ownerPersonId,
        generation: b.generation,
        curve: b.curve,
        length: b.length,
        thickness: b.thickness,
        candidateScore: b.candidateScore,
      })),
      nodes: allNodes.map((n) => ({ id: n.id, point: n.point, kind: n.kind })),
      mappedJunctions,
      diagnostics,
      validation: validationResult,
      configurationUsed: input.configuration,
      status: planStatus,
    };

    const deterministicFingerprint = await sha256Canonical(fingerprintInput);

    const plan: SkeletonPlan = Object.freeze({
      schemaVersion: "1.0",
      engineVersion: "0.2.0",
      skeletonPlanId: asSkeletonPlanId(
        `${planStatus === "ACCEPTED" ? "skeleton" : "rejected"}:${deterministicFingerprint.slice(0, 24)}`,
      ),
      status: planStatus,
      selectedRootId: input.selectedRootId,
      sourceChecksum: input.sourceChecksum,
      seed: input.seed,
      territoryPlanFingerprint: territoryPlan.deterministicFingerprint,
      trunk,
      branches: Object.freeze(allBranches),
      nodes: Object.freeze(allNodes),
      mappedJunctions: Object.freeze(mappedJunctions),
      diagnostics: Object.freeze(diagnostics),
      validation: validationResult,
      configurationUsed: Object.freeze({ ...input.configuration }),
      metadata: Object.freeze({
        algorithm: "RECURSIVE_ORGANIC_GROWTH",
        branchCount: finalBranchCount,
        nodeCount: allNodes.length,
        maximumGenealogyDepth: maxDepth,
        maximumSkeletonDepth: maxDepth,
        totalInvalidCandidateCount: totalInvalidCandidates,
        totalRejectedCandidateCount: totalRejectedCandidates,
      }),
      deterministicFingerprint,
    });

    input.diagnostics?.emit({
      stage: "FREEZE_SKELETON",
      eventType: finalBranchCount > 0 ? "STAGE_END" : "STAGE_SKIP",
      entityId: input.selectedRootId,
      metrics: {
        branchCount: finalBranchCount,
        nodeCount: allNodes.length,
        maxDepth,
        accepted: planStatus === "ACCEPTED" ? 1 : 0,
      },
    });

    return plan;
  }
}

// ── Helper: generate evenly-spaced child directions ──────────────────

const generateChildDirections = (
  parentDirection: Vec2,
  childCount: number,
  seed: number,
): readonly Vec2[] => {
  if (childCount === 0) return [];
  if (childCount === 1) return [parentDirection];

  const directions: Vec2[] = [];
  const spreadAngle = Math.PI * 0.4;

  for (let index = 0; index < childCount; index += 1) {
    const ratio = (index / (childCount - 1)) * 2 - 1;
    const angle = ratio * spreadAngle;
    const jitter = (stableUnit(`child-dir-${index}-${seed}`, seed) * 2 - 1) * 0.08;
    const finalAngle = angle + jitter;
    const cos = Math.cos(finalAngle);
    const sin = Math.sin(finalAngle);
    directions.push({
      x: parentDirection.x * cos - parentDirection.y * sin,
      y: parentDirection.x * sin + parentDirection.y * cos,
    });
  }

  return directions;
};
