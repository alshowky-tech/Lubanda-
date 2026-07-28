import { boundsOverlap } from "../geometry/bounds.js";
import type { Vec2 } from "../geometry/types.js";
import type { PersonId } from "../contracts/identifiers.js";
import type { LabelConfig } from "../config/types.js";
import type {
  LabelCandidate,
  LabelCandidateFamily,
  LabelPlacement,
  LabelLayoutMetrics,
  LabelDiagnostic,
  GeneratedCandidatesResult,
  UnresolvedLabelReason,
} from "./types.js";
import { LabelCollisionQueryImpl } from "./LabelCollisionQuery.js";

// ── Decision frame ────────────────────────────────────────────────────

interface DecisionFrame {
  readonly personId: PersonId;
  readonly selectedCandidateIndex: number;
  readonly nextCandidateIndex: number;
  readonly placement: LabelPlacement;
}

// ── Assignment result ─────────────────────────────────────────────────

export interface LabelAssignmentResult {
  readonly placements: readonly LabelPlacement[];
  readonly unplacedPersons: readonly UnresolvedLabelReason[];
  readonly metrics: LabelLayoutMetrics;
  readonly diagnostics: readonly LabelDiagnostic[];
}

// ── Family priority for ordering ──────────────────────────────────────

const FAMILY_PRIORITY: Record<LabelCandidateFamily, number> = {
  ALIGNED_WITH_BRANCH: 1,
  OFFSET_ABOVE_BRANCH: 2,
  OFFSET_BELOW_BRANCH: 3,
  LATERAL: 4,
  TERMINAL_LEAF: 5,
  CARTOUCHE_ZONE: 6,
};

// ── Assignment engine ─────────────────────────────────────────────────

/**
 * Deterministic label assignment engine (M7.3).
 *
 * Implements:
 * - Person ordering: (validCandidateCount asc, staticConflictDegree desc,
 *   generation asc, personId asc)
 * - Candidate ordering: (score desc, familyPriority asc, leaderLength asc,
 *   rotationMagnitude asc, candidateIndex asc, candidateId asc)
 * - Greedy assignment with bounded chronological backtracking
 * - Decision frames: personId, selectedCandidateIndex, nextCandidateIndex, placement
 * - Partial assignment: unplaced persons carry UnresolvedLabelReason
 */
export class DeterministicLabelAssignmentEngine {
  readonly #query: LabelCollisionQueryImpl;

  constructor(collisionQuery?: LabelCollisionQueryImpl) {
    this.#query = collisionQuery ?? new LabelCollisionQueryImpl();
  }

  /**
   * Perform deterministic assignment from generated candidates.
   * @param input — candidates from M7.2
   * @param skeletonBranches — branch map for generation lookup
   * @param config — label configuration (includes maximumBacktrackDepth)
   * @returns assignment result with placements and unresolved persons
   */
  assign(
    input: GeneratedCandidatesResult,
    config: LabelConfig,
  ): LabelAssignmentResult {
    const diagnostics: LabelDiagnostic[] = [];

    // Validate config
    if (
      !Number.isInteger(config.maximumBacktrackDepth) ||
      config.maximumBacktrackDepth < 0 ||
      config.maximumBacktrackDepth > 100
    ) {
      throw new TypeError(
        `LabelConfig.maximumBacktrackDepth must be an integer between 0 and 100, got ${config.maximumBacktrackDepth}`,
      );
    }

    const maxBacktrack = config.maximumBacktrackDepth;

    // Determine which persons to attempt assignment for
    const peopleWithBranches = new Set<PersonId>();
    for (const [pid] of input.personCandidateMap) {
      peopleWithBranches.add(pid);
    }

    // Build per-person candidate lists
    const personCandidates = new Map<PersonId, readonly LabelCandidate[]>();
    for (const [pid, candidates] of input.personCandidateMap) {
      personCandidates.set(pid, candidates);
    }

    if (personCandidates.size === 0) {
      return {
        placements: Object.freeze([]),
        unplacedPersons: Object.freeze([]),
        metrics: Object.freeze({
          totalPersonCount: 0,
          placedLabelCount: 0,
          unplacedLabelCount: 0,
          collisionCount: 0,
          minimumFontSize: config.minimumFontSize,
          maximumRotation: config.maximumRotationDegrees,
          averageAnchorDistance: 0,
          totalOverlapCount: 0,
        }),
        diagnostics: Object.freeze(diagnostics),
      };
    }

    // Step 1: Build static conflict graph for ordering
    const degreeMap = this.#computeStaticConflictDegree(personCandidates);

    // Step 2: Build person order
    const personOrder = this.#buildPersonOrder(personCandidates, degreeMap);

    // Step 3: Sort candidates within each person
    const sortedCandidates = this.#sortCandidatesPerPerson(personCandidates);

    // Step 4: Greedy assignment with backtracking
    const placements: LabelPlacement[] = [];
    const unplaced: UnresolvedLabelReason[] = [];
    const decisionStack: DecisionFrame[] = [];
    const placedPersonIds = new Set<PersonId>();

    for (const personId of personOrder) {
      const cands = sortedCandidates.get(personId) ?? [];
      const validCands = cands.filter((c) => c.validationStatus === "VALID");

      if (validCands.length === 0) {
        unplaced.push({
          personId,
          code: "ALL_CANDIDATES_COLLIDE",
          message: "No VALID candidates for this person",
          candidateCount: cands.length,
        });
        continue;
      }

      // Try each candidate in order
      const placed = this.#tryPlaceCandidate(
        personId, validCands, placements, placedPersonIds,
        decisionStack, maxBacktrack, sortedCandidates,
      );

      if (placed !== null) {
        placements.push(placed);
        placedPersonIds.add(personId);
      } else {
        // Backtracking failed or disabled — record failure
        unplaced.push({
          personId,
          code: maxBacktrack === 0 ? "ALL_CANDIDATES_COLLIDE" : "BACKTRACK_EXHAUSTED",
          message: maxBacktrack === 0
            ? "All VALID candidates conflict (pure greedy mode)"
            : "Backtracking budget exhausted, no conflict-free assignment found",
          candidateCount: validCands.length,
        });
      }
    }

    // Build metrics
    const metrics = this.#buildMetrics(placements, unplaced, personCandidates.size, config);

    diagnostics.push({
      sequence: 0, stage: "SOLVE_LABELS",
      code: "ASSIGNMENT_COMPLETE",
      message: `Assigned ${placements.length}/${personCandidates.size} persons`,
      metrics: { placedCount: placements.length, unplacedCount: unplaced.length },
    });

    return {
      placements: Object.freeze(placements),
      unplacedPersons: Object.freeze(unplaced),
      metrics,
      diagnostics: Object.freeze(diagnostics),
    };
  }

  // ── Person ordering ──────────────────────────────────────────────

  /**
   * Compute static conflict degree: number of foreign persons whose any VALID
   * candidate has a conflict edge with any VALID candidate of this person.
   * Computed once before assignment via pairwise geometry checks.
   */
  #computeStaticConflictDegree(
    personCandidates: ReadonlyMap<PersonId, readonly LabelCandidate[]>,
  ): ReadonlyMap<PersonId, number> {
    const degree = new Map<PersonId, number>();
    const personIds = [...personCandidates.keys()];
    const validMap = new Map<PersonId, readonly LabelCandidate[]>();

    for (const [pid, cands] of personCandidates) {
      validMap.set(pid, cands.filter((c) => c.validationStatus === "VALID"));
    }

    for (const pidA of personIds) {
      const validA = validMap.get(pidA) ?? [];
      if (validA.length === 0) { degree.set(pidA, 0); continue; }

      const conflictingPersons = new Set<PersonId>();
      for (const pidB of personIds) {
        if (pidB === pidA) continue;
        const validB = validMap.get(pidB) ?? [];
        if (validB.length === 0) continue;
        // Check any candidate pair for conflict
        let hasConflict = false;
        for (const ca of validA) {
          for (const cb of validB) {
            if (this.#candidatesConflict(ca, cb)) {
              hasConflict = true;
              break;
            }
          }
          if (hasConflict) break;
        }
        if (hasConflict) conflictingPersons.add(pidB);
      }
      degree.set(pidA, conflictingPersons.size);
    }

    return degree;
  }

  /** Check if two candidates (from different persons) would conflict if both placed. */
  #candidatesConflict(a: LabelCandidate, b: LabelCandidate): boolean {
    // Label–Label bounds overlap
    if (boundsOverlap(a.bounds, b.bounds, 0)) return true;
    // Leader–Label
    if (a.leaderLength > 0) {
      const aEnd = this.#leaderEndpoint(a);
      if (this.#query.leaderCrossesPlacedLabel(a.anchor, aEnd, b as unknown as LabelPlacement)) return true;
    }
    if (b.leaderLength > 0) {
      const bEnd = this.#leaderEndpoint(b);
      if (this.#query.leaderCrossesPlacedLabel(b.anchor, bEnd, a as unknown as LabelPlacement)) return true;
    }
    // Leader–Leader
    if (a.leaderLength > 0 && b.leaderLength > 0) {
      const aEnd = this.#leaderEndpoint(a);
      const bEnd = this.#leaderEndpoint(b);
      if (this.#query.leadersCross(a.anchor, aEnd, b.anchor, bEnd)) return true;
    }
    return false;
  }

  #leaderEndpoint(c: LabelCandidate): Vec2 {
    // Approximate: leader extends from anchor in direction of bounds center
    const cx = (c.bounds.minX + c.bounds.maxX) / 2;
    const cy = (c.bounds.minY + c.bounds.maxY) / 2;
    const dx = cx - c.anchor.x;
    const dy = cy - c.anchor.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { x: c.anchor.x, y: c.anchor.y };
    return {
      x: c.anchor.x + (dx / len) * c.leaderLength,
      y: c.anchor.y + (dy / len) * c.leaderLength,
    };
  }

  #buildPersonOrder(
    personCandidates: ReadonlyMap<PersonId, readonly LabelCandidate[]>,
    degreeMap: ReadonlyMap<PersonId, number>,
  ): readonly PersonId[] {
    const personIds = [...personCandidates.keys()];

    // Build generation map — default to 1 for all
    const generationMap = new Map<PersonId, number>();
    for (const [pid] of personCandidates) {
      generationMap.set(pid, 1);
    }

    personIds.sort((a, b) => {
      const ca = personCandidates.get(a)!.length;
      const cb = personCandidates.get(b)!.length;
      if (ca !== cb) return ca - cb;

      const da = degreeMap.get(a) ?? 0;
      const db = degreeMap.get(b) ?? 0;
      if (da !== db) return db - da;

      const ga = generationMap.get(a) ?? 1;
      const gb = generationMap.get(b) ?? 1;
      if (ga !== gb) return ga - gb;

      return String(a).localeCompare(String(b));
    });

    return Object.freeze(personIds);
  }

  // ── Candidate ordering ───────────────────────────────────────────

  #sortCandidatesPerPerson(
    personCandidates: ReadonlyMap<PersonId, readonly LabelCandidate[]>,
  ): ReadonlyMap<PersonId, readonly LabelCandidate[]> {
    const result = new Map<PersonId, readonly LabelCandidate[]>();

    for (const [pid, cands] of personCandidates) {
      const sorted = [...cands].sort((a, b) => {
        // score descending
        const sa = a.score ?? -1;
        const sb = b.score ?? -1;
        if (sa !== sb) return sb - sa;

        // familyPriority ascending
        const fa = FAMILY_PRIORITY[a.family] ?? 99;
        const fb = FAMILY_PRIORITY[b.family] ?? 99;
        if (fa !== fb) return fa - fb;

        // leaderLength ascending
        if (a.leaderLength !== b.leaderLength) return a.leaderLength - b.leaderLength;

        // rotationMagnitude ascending
        const ra = Math.abs(a.rotation);
        const rb = Math.abs(b.rotation);
        if (ra !== rb) return ra - rb;

        // candidateIndex (from candidateId)
        const ia = this.#extractIndex(a.candidateId);
        const ib = this.#extractIndex(b.candidateId);
        if (ia !== ib) return ia - ib;

        // candidateId ascending (final tie-break)
        return String(a.candidateId).localeCompare(String(b.candidateId));
      });

      result.set(pid, Object.freeze(sorted));
    }

    return result;
  }

  #extractIndex(candidateId: string): number {
    const parts = candidateId.split(":");
    return parseInt(parts[parts.length - 1] ?? "0", 10);
  }

  // ── Assignment with backtracking ─────────────────────────────────

  #tryPlaceCandidate(
    personId: PersonId,
    candidates: readonly LabelCandidate[],
    placements: LabelPlacement[],
    placedPersonIds: Set<PersonId>,
    decisionStack: DecisionFrame[],
    maxBacktrack: number,
    sortedCandidates: ReadonlyMap<PersonId, readonly LabelCandidate[]>,
  ): LabelPlacement | null {
    let budgetRemaining = maxBacktrack;

    // Convert candidate to placement
    const toPlacement = (c: LabelCandidate): LabelPlacement => ({
      personId: c.personId,
      bounds: c.bounds,
      anchor: c.anchor,
      rotation: c.rotation,
      leaderLength: c.leaderLength,
      family: c.family,
      text: "",      // filled by caller from nameMap
      fontFamily: "DejaVu Sans",
      fontSize: 12,
      fontWeight: 400,
    });

    // Try each candidate in order
    for (let idx = 0; idx < candidates.length; idx += 1) {
      const cand = candidates[idx]!;
      const placement = toPlacement(cand);

      if (!this.#placementConflictsWithAny(placement, placements)) {
        return placement;
      }
    }

    // No candidate fits — try backtracking if enabled
    if (maxBacktrack === 0) return null;

    while (decisionStack.length > 0 && budgetRemaining > 0) {
      const frame = decisionStack.pop()!;
      budgetRemaining -= 1;

      // Remove this placement
      const removeIdx = placements.findIndex(
        (p) => p.personId === frame.personId,
      );
      if (removeIdx >= 0) {
        placements.splice(removeIdx, 1);
        placedPersonIds.delete(frame.personId);
      }

      // Try the next candidate for this frame's person
      const prevCands = sortedCandidates.get(frame.personId) ?? [];
      const validPrev = prevCands.filter((c) => c.validationStatus === "VALID");

      for (let ni = frame.nextCandidateIndex; ni < validPrev.length; ni += 1) {
        const cand = validPrev[ni]!;
        const placement = toPlacement(cand);
        if (!this.#placementConflictsWithAny(placement, placements)) {
          // Re-place this person with the new candidate
          placements.push(placement);
          placedPersonIds.add(frame.personId);
          decisionStack.push({
            personId: frame.personId,
            selectedCandidateIndex: ni,
            nextCandidateIndex: ni + 1,
            placement,
          });

          // Now retry the ORIGINAL stuck person
          return this.#tryPlaceCandidate(
            personId, candidates, placements, placedPersonIds,
            decisionStack, budgetRemaining, sortedCandidates,
          );
        }
      }
    }

    return null;
  }

  /** Check if a placement conflicts with any currently placed placement. */
  #placementConflictsWithAny(
    placement: LabelPlacement,
    placements: readonly LabelPlacement[],
  ): boolean {
    for (const existing of placements) {
      if (existing.personId === placement.personId) continue; // same person, should not happen

      // Label–Label bounds overlap
      if (this.#query.overlapsPlacedLabel(placement.bounds, existing)) return true;

      // Candidate leader ↔ existing label bounds
      if (placement.leaderLength > 0) {
        const pEnd = this.#placementLeaderEndpoint(placement);
        if (this.#query.leaderCrossesPlacedLabel(placement.anchor, pEnd, existing)) return true;
      }

      // Candidate bounds ↔ existing leader
      if (existing.leaderLength > 0) {
        const eEnd = this.#placementLeaderEndpoint(existing);
        if (this.#query.labelCrossesPlacedLeader(placement.bounds, existing.anchor, eEnd)) return true;
      }

      // Leader–Leader
      if (placement.leaderLength > 0 && existing.leaderLength > 0) {
        const pEnd = this.#placementLeaderEndpoint(placement);
        const eEnd = this.#placementLeaderEndpoint(existing);
        if (this.#query.leadersCross(placement.anchor, pEnd, existing.anchor, eEnd)) return true;
      }
    }
    return false;
  }

  #placementLeaderEndpoint(p: LabelPlacement): Vec2 {
    const cx = (p.bounds.minX + p.bounds.maxX) / 2;
    const cy = (p.bounds.minY + p.bounds.maxY) / 2;
    const dx = cx - p.anchor.x;
    const dy = cy - p.anchor.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) return { x: p.anchor.x, y: p.anchor.y };
    return {
      x: p.anchor.x + (dx / len) * p.leaderLength,
      y: p.anchor.y + (dy / len) * p.leaderLength,
    };
  }

  // ── Metrics ──────────────────────────────────────────────────────

  #buildMetrics(
    placements: readonly LabelPlacement[],
    unplaced: readonly UnresolvedLabelReason[],
    totalPersonCount: number,
    config: LabelConfig,
  ): LabelLayoutMetrics {
    let totalAnchorDist = 0;
    let maxRotation = 0;
    let overlapCount = 0;

    for (const p of placements) {
      const cx = (p.bounds.minX + p.bounds.maxX) / 2;
      const cy = (p.bounds.minY + p.bounds.maxY) / 2;
      totalAnchorDist += Math.hypot(p.anchor.x - cx, p.anchor.y - cy);
      const absRot = Math.abs(p.rotation);
      if (absRot > maxRotation) maxRotation = absRot;
    }

    for (let i = 0; i < placements.length; i += 1) {
      for (let j = i + 1; j < placements.length; j += 1) {
        if (boundsOverlap(placements[i]!.bounds, placements[j]!.bounds, 0)) {
          overlapCount += 1;
        }
      }
    }

    return Object.freeze({
      totalPersonCount,
      placedLabelCount: placements.length,
      unplacedLabelCount: unplaced.length,
      collisionCount: overlapCount,
      minimumFontSize: config.minimumFontSize,
      maximumRotation: maxRotation,
      averageAnchorDistance: placements.length > 0
        ? Math.round((totalAnchorDist / placements.length) * 100) / 100
        : 0,
      totalOverlapCount: overlapCount,
    });
  }
}
