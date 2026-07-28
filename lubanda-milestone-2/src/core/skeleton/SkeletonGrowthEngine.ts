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
import { classifyPointInPolygon } from "../geometry/polygon.js";
import { evaluateCubicBezier, sampleCubicBezier } from "../geometry/bezier.js";
import type { CubicBezier, Vec2, Bounds, Polygon } from "../geometry/types.js";
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
  CandidateGenerationInput,
  CandidateRejectionRecord,
  BranchRejectionReason,
  CurveRecord,
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
    const allBranchBounds: Bounds[] = [];
    const allBranchCurves: CurveRecord[] = [];
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
      allBranchCurves.push({branchId: trunkBranchId, samples: sampleCubicBezier(trunkSegmentCurve, { tolerance: 4, maxSubdivisionDepth: 10 })});

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
      allBranchCurves.push({branchId: finalBranchId, samples: sampleCubicBezier(finalCurve, { tolerance: 4, maxSubdivisionDepth: 10 })});

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
      existingBounds: Bounds[],
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
      const direction = toEndLen > EPSILON
        ? normalize(toEnd)
        : parentDirection ?? TRUNK_UPWARD_DIRECTION;

      // Generate and evaluate candidates
      const territoryPolygon = territory?.polygon ?? null;
      // Major lineage branches (parentBranchId === null) start at trunk junctions
      // which may be outside the territory. Use relaxed check for those.
      const relaxedTerritory = parentBranchId === null;
      const candidateInput: CandidateGenerationInput = {
        startPoint,
        endPoint,
        startDirection: parentDirection ?? TRUNK_UPWARD_DIRECTION,
        ownerPersonId: personId,
        territoryPolygon,
        templatePolygon,
        attractors: attractorField,
        config: input.configuration,
        seed: input.seed + skeletonDepth * 13 + branches.size * 7,
        existingBranchBounds: existingBounds,
        existingBranchCurves: allBranchCurves,
        excludeParentBranchId: parentBranchId,
        relaxedTerritoryCheck: relaxedTerritory,
        candidateCount: input.configuration.candidateCount,
        genealogyDepth,
        roundingDecimalPlaces: decimalPlaces,
      };

      const candidates = generateBranchCandidates(candidateInput);
      const rejectionHistory: CandidateRejectionRecord[] = [];
      for (const c of candidates) {
        if (!c.valid) {
          for (const reason of c.rejectionReasons) {
            rejectionHistory.push({ candidateIndex: c.index, reason });
          }
        }
      }
      totalInvalidCandidates += candidates.filter((c) => !c.valid).length;

      const scored = scoreBranchCandidates(
        candidates,
        parentDirection ?? TRUNK_UPWARD_DIRECTION,
        attractorField,
        input.seed + skeletonDepth * 17,
      );

      const selected = selectBestCandidate(scored);
      const acceptedCandidateIndex = selected?.index ?? null;
      totalRejectedCandidates += candidates.filter(
        (c) => c.valid && c.index !== selected?.index,
      ).length;

      // 💥 Correction 1: Hard candidate rejection — no fallback branch
      if (!selected) {
        addDiagnostic(
          "RECURSIVE_GROWTH",
          "NO_VALID_CANDIDATE",
          { candidateCount: candidates.length },
          undefined,
          personId,
          "NO_VALID_CANDIDATE",
          candidates.length,
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

      // 💥 Defect 1 FIX: Use the exact startNodeId provided by the caller.
      // For major lineage branches (parentBranchId === null), the caller
      // provides the trunk junction node. For children, the caller provides
      // either a BRANCH_SPLIT node or the parent's end node.
      // We NEVER override this with parentBr.endNodeId.
      const usedStartNodeId = startNodeId;

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
        startNodeId: usedStartNodeId,
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
      allBranchBounds.push(...branchBounds(branch));
      allBranchCurves.push({branchId: branchId, samples: sampleCubicBezier(branchCurve, { tolerance: 4, maxSubdivisionDepth: 10 })});

      addDiagnostic(
        "RECURSIVE_GROWTH",
        "BRANCH_GROWN",
        {
          length: branch.length,
          score: selected.score ?? 0,
          candidateCount: candidates.length,
          validCount: candidates.filter((c) => c.valid).length,
        },
        branchId,
        personId,
        undefined,
        candidates.length,
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
        // a real BRANCH_SPLIT node at a point ON THE PARENT BEZIER CURVE.
        // Otherwise start from the parent's end node.
        let childStartNodeId: string;
        let childStartPoint: Vec2;

        if (children.length > 1) {
          // Evaluate on the actual parent cubic Bezier at parameter t
          const t = 0.55 + (childIndex / Math.max(1, children.length)) * 0.4;
          childStartPoint = evaluateCubicBezier(branchCurve, t);
          const splitNodeId = nextNodeId("branch-split");
          const splitNode: SkeletonNode = {
            id: splitNodeId,
            point: childStartPoint,
            kind: "BRANCH_SPLIT",
            incomingBranchId: branchId,
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

        const result = growBranchRecursive(
          childId,
          branchId,
          childStartPoint,
          childStartNodeId,
          childDir,
          genealogyDepth + 1,
          skeletonDepth + 1,
          allBranchBounds,
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

      // Update parent node connections — use usedStartNodeId (the actual start node)
      const parentNode = nodes.get(usedStartNodeId);
      if (parentNode) {
        nodes.set(usedStartNodeId, {
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
        allBranchBounds,
      );
    }

    // ── If growth failed, return REJECTED plan ──
    if (growthFailed) {
      const rejectionDiagnostic: SkeletonDiagnostic = Object.freeze({
        sequence: diagnosticSequence,
        stage: "SKELETON_VALIDATION",
        code: "SKELETON_NO_VALID_CANDIDATE",
        ...(growthFailurePersonId === null ? {} : { ownerPersonId: growthFailurePersonId }),
        metrics: { totalInvalidCandidates, totalRejectedCandidates },
        rejectionReason: "NO_VALID_CANDIDATE",
      });
      diagnostics.push(rejectionDiagnostic);

      const allBranches = [...branches.values()];
      const allNodes = [...nodes.values()];
      const rejectedFingerprint = await sha256Canonical({
        status: "REJECTED",
        selectedRootId: input.selectedRootId,
        sourceChecksum: input.sourceChecksum,
        seed: input.seed,
        failurePersonId: growthFailurePersonId,
        diagnosticCount: diagnostics.length,
      });

      return Object.freeze({
        schemaVersion: "1.0",
        engineVersion: "0.2.0",
        skeletonPlanId: asSkeletonPlanId(`rejected:${rejectedFingerprint.slice(0, 24)}`),
        status: "REJECTED",
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
          accepted: false,
          issues: Object.freeze([]),
          metrics: {
            branchCount: allBranches.length,
            nodeCount: allNodes.length,
            trunkSegmentCount: trunk.segments.length,
            junctionCount: mappedJunctions.length,
            invalidBranchCount: 0,
            missingPersonBranchCount: 0,
            orphanBranchCount: 0,
            territoryMissCount: 0,
            outOfBoundsCount: 0,
            intersectionCount: 0,
            totalCurveLength: roundDeterministic(allBranches.reduce((s, b) => s + b.length, 0), decimalPlaces),
            maxDepth: 0,
            acceptedPersonCount: allBranches.length,
            connectedPersonCount: allBranches.filter((b) => b.parentBranchId !== null || b.generation === 0).length,
          },
        }),
        configurationUsed: Object.freeze({ ...input.configuration }),
        metadata: Object.freeze({
          algorithm: "RECURSIVE_ORGANIC_GROWTH",
          branchCount: allBranches.length,
          nodeCount: allNodes.length,
          maximumGenealogyDepth: 0,
          maximumSkeletonDepth: 0,
          totalInvalidCandidateCount: totalInvalidCandidates,
          totalRejectedCandidateCount: totalRejectedCandidates,
        }),
        deterministicFingerprint: rejectedFingerprint,
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

// ── Helper: compute approximate bounds for a branch ──────────────────

const branchBounds = (branch: SkeletonBranch): readonly Bounds[] => {
  const points = [
    branch.curve.p0,
    branch.curve.p1,
    branch.curve.p2,
    branch.curve.p3,
  ];
  return [
    {
      minX: Math.min(...points.map((p) => p.x)) - 20,
      minY: Math.min(...points.map((p) => p.y)) - 20,
      maxX: Math.max(...points.map((p) => p.x)) + 20,
      maxY: Math.max(...points.map((p) => p.y)) + 20,
    },
  ];
};

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
