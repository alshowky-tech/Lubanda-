import {
  asCorridorId,
  asTerritoryId,
  asTerritoryPlanId,
  stageFailure,
  stageSuccess,
  type EngineIssue,
  type PersonId,
  type StageResult,
} from "../contracts/index.js";
import { sha256Canonical } from "../determinism/canonical-json.js";
import { roundDeterministic } from "../determinism/numeric.js";
import { boundsFromPoints } from "../geometry/bounds.js";
import type { Polygon } from "../geometry/types.js";
import { planGrowthCorridors } from "./CorridorPlanner.js";
import {
  canonicalizePolygon,
  insetConvexPolygon,
  polygonArea,
  polygonCentroid,
} from "./polygon-geometry.js";
import {
  createDeterministicSites,
  negotiatePowerCells,
  partitionConvexPolygonByDemand,
} from "./power-diagram.js";
import { prepareTemplate } from "./template-boundary.js";
import { TerritoryValidator } from "./TerritoryValidator.js";
import type {
  AllocationDiagnostic,
  Territory,
  TerritoryBoundaryMovement,
  TerritoryNegotiationState,
  TerritoryPlan,
  TerritoryPlanner as TerritoryPlannerContract,
  TerritoryPlanningInput,
  TerritoryValidationReport,
} from "./types.js";

const problem = (
  code: EngineIssue["code"],
  stage: EngineIssue["stage"],
  details: Readonly<Record<string, unknown>>,
  entityIds: readonly string[] = [],
): EngineIssue => ({
  code,
  severity: "ERROR",
  messageKey: `territory.${code.toLocaleLowerCase("en-US")}`,
  stage,
  ...(entityIds.length === 0 ? {} : { entityIds }),
  details,
  recoverable: true,
});

const mergeValidation = (
  report: TerritoryValidationReport,
  additionalIssues: readonly EngineIssue[],
): TerritoryValidationReport => ({
  ...report,
  accepted: report.accepted && additionalIssues.length === 0,
  issues: Object.freeze([...report.issues, ...additionalIssues]),
});

export class DeterministicTerritoryPlanner
  implements TerritoryPlannerContract
{
  async plan(
    input: TerritoryPlanningInput,
  ): Promise<StageResult<TerritoryPlan>> {
    const epsilon = 1e-7;
    const decimalPlaces = input.configuration.roundingDecimalPlaces;
    const diagnostics: AllocationDiagnostic[] = [];
    let diagnosticSequence = 0;
    const addDiagnostic = (
      value: Omit<AllocationDiagnostic, "sequence">,
    ): void => {
      diagnostics.push(
        Object.freeze({ sequence: diagnosticSequence, ...value }),
      );
      diagnosticSequence += 1;
    };
    if (!Number.isSafeInteger(input.seed)) {
      return stageFailure([
        problem(
          "MALFORMED_VALUE",
          "ALLOCATE_TERRITORIES",
          { field: "seed" },
        ),
      ]);
    }
    if (
      input.demandPlan.selectedRootId !== input.selectedRootId ||
      input.demandPlan.sourceChecksum !== input.sourceChecksum
    ) {
      return stageFailure([
        problem(
          "TERRITORY_RELATION_INVALID",
          "ALLOCATE_TERRITORIES",
          { reason: "Demand plan does not match selected root or source" },
        ),
      ]);
    }
    const prepared = prepareTemplate(
      input.templateBoundary,
      input.selectedRootId,
      input.configuration,
      epsilon,
    );
    if (!prepared) {
      return stageFailure([
        problem(
          "TEMPLATE_INVALID",
          "ALLOCATE_TERRITORIES",
          {
            reason:
              "Template must be finite, simple, convex, and contain the configured root-entry reservation",
          },
        ),
      ]);
    }
    input.diagnostics?.emit({
      stage: "ALLOCATE_TERRITORIES",
      eventType: "STAGE_START",
      entityId: input.selectedRootId,
    });
    const majorLineageIds =
      input.graph.childrenByParentId.get(input.selectedRootId) ?? [];
    const demandByPerson = new Map(
      input.demandPlan.results.map((result) => [result.personId, result] as const),
    );
    const territoryAvailableArea = polygonArea(prepared.territoryPolygon);
    const requiredAreas = majorLineageIds.map((id) =>
      Math.max(
        input.configuration.minimumTerritoryArea,
        demandByPerson.get(id)?.spatial.requiredArea ?? 0,
      ),
    );
    const totalRequiredArea = requiredAreas.reduce(
      (total, value) => total + value,
      0,
    );
    if (totalRequiredArea > territoryAvailableArea + epsilon) {
      return stageFailure([
        problem(
          "TERRITORY_AREA_INSUFFICIENT",
          "ALLOCATE_TERRITORIES",
          {
            totalRequiredArea,
            territoryAvailableArea,
            lineageCount: majorLineageIds.length,
          },
          majorLineageIds,
        ),
      ]);
    }
    if (majorLineageIds.length === 0) {
      const emptyReport = new TerritoryValidator().validate({
        selectedRootId: input.selectedRootId,
        majorLineageIds,
        templatePolygon: prepared.templatePolygon,
        rootEntryReservation: prepared.rootEntryReservation,
        territories: [],
        corridors: [],
        junctionZones: [],
        configuration: input.configuration,
        serializableCandidate: { territories: [], corridors: [] },
      });
      const fingerprintInput = {
        selectedRootId: input.selectedRootId,
        sourceChecksum: input.sourceChecksum,
        seed: input.seed,
        templateBoundary: input.templateBoundary,
        rootEntryReservation: prepared.rootEntryReservation,
        validation: emptyReport,
      };
      const deterministicFingerprint = await sha256Canonical(fingerprintInput);
      const plan: TerritoryPlan = Object.freeze({
        schemaVersion: "1.0",
        engineVersion: "0.2.0",
        territoryPlanId: asTerritoryPlanId(
          `territory:${deterministicFingerprint.slice(0, 24)}`,
        ),
        status: "ACCEPTED",
        selectedRootId: input.selectedRootId,
        sourceChecksum: input.sourceChecksum,
        seed: input.seed,
        templateBoundary: input.templateBoundary,
        templatePolygon: prepared.templatePolygon,
        usableBounds: boundsFromPoints(prepared.territoryPolygon.points),
        rootEntryReservation: prepared.rootEntryReservation,
        territories: Object.freeze([]),
        junctionZones: Object.freeze([]),
        corridors: Object.freeze([]),
        negotiation: Object.freeze({
          status: "NOT_REQUIRED",
          iterations: 0,
          maximumIterations: input.configuration.maxNegotiationIterations,
          finalMaximumAreaErrorRatio: 0,
          movements: Object.freeze([]),
          convergenceReason: "INITIAL_PLAN_VALID",
        }),
        diagnostics: Object.freeze([]),
        validation: emptyReport,
        configurationUsed: Object.freeze({ ...input.configuration }),
        demandFingerprint:
          input.demandPlan.computationMetadata.deterministicFingerprint,
        deterministicFingerprint,
      });
      return stageSuccess(plan, input.diagnostics?.snapshot() ?? []);
    }

    const totalDemand = requiredAreas.reduce((total, value) => total + value, 0);
    const demandShares = requiredAreas.map((value) => value / totalDemand);
    const remainingArea = Math.max(
      0,
      territoryAvailableArea - totalRequiredArea,
    );
    const targetAreas = requiredAreas.map(
      (required, index) =>
        required + remainingArea * (demandShares[index] as number),
    );
    const initialSites = createDeterministicSites(
      majorLineageIds,
      demandShares,
      prepared.territoryPolygon,
      input.seed,
      input.configuration.seedJitter,
    );
    let negotiated = negotiatePowerCells(
      prepared.territoryPolygon,
      initialSites,
      targetAreas,
      input.configuration.maxNegotiationIterations,
      input.configuration.maximumAreaErrorRatio,
      input.configuration.convergenceTolerance,
      epsilon,
      decimalPlaces,
    );
    let emptyCellOwnerIds = negotiated.cells
      .map((cell, index) =>
        cell.points.length < 3 ||
        !Number.isFinite(polygonArea(cell)) ||
        polygonArea(cell) <= epsilon
          ? (majorLineageIds[index] as PersonId)
          : null,
      )
      .filter((id): id is PersonId => id !== null);
    if (
      input.configuration.maxNegotiationIterations > 0 &&
      (!negotiated.converged || emptyCellOwnerIds.length > 0)
    ) {
      const transferredCells = partitionConvexPolygonByDemand(
        prepared.territoryPolygon,
        targetAreas,
        input.seed,
        epsilon,
        decimalPlaces,
      );
      const maximumAreaErrorRatio = Math.max(
        ...transferredCells.map((cell, index) =>
          Math.abs((targetAreas[index] as number) - polygonArea(cell)) /
          (targetAreas[index] as number),
        ),
        0,
      );
      negotiated = {
        cells: transferredCells,
        sites: negotiated.sites,
        iterations: Math.min(
          input.configuration.maxNegotiationIterations,
          Math.max(1, negotiated.iterations),
        ),
        maximumAreaErrorRatio,
        converged:
          maximumAreaErrorRatio <=
          input.configuration.maximumAreaErrorRatio,
        snapshots: Object.freeze([
          negotiated.snapshots[0] ?? negotiated.cells,
          transferredCells,
        ]),
      };
      emptyCellOwnerIds = negotiated.cells
        .map((cell, index) =>
          cell.points.length < 3 || polygonArea(cell) <= epsilon
            ? (majorLineageIds[index] as PersonId)
            : null,
        )
        .filter((id): id is PersonId => id !== null);
    }
    if (emptyCellOwnerIds.length > 0) {
      return stageFailure([
        problem(
          "TERRITORY_INVALID_GEOMETRY",
          "NEGOTIATE_TERRITORIES",
          { reason: "EMPTY_POWER_CELL", count: emptyCellOwnerIds.length },
          emptyCellOwnerIds,
        ),
      ]);
    }
    addDiagnostic({
      stage: "INITIAL_ALLOCATION",
      code: "POWER_DIAGRAM_ALLOCATED",
      metrics: {
        lineageCount: majorLineageIds.length,
        availableArea: territoryAvailableArea,
        initialMaximumAreaErrorRatio:
          negotiated.snapshots.length === 0
            ? 0
            : Math.max(
                ...negotiated.snapshots[0]!.map((cell, index) =>
                  Math.abs(
                    (targetAreas[index] as number) - polygonArea(cell),
                  ) / (targetAreas[index] as number),
                ),
              ),
      },
    });
    const movements: TerritoryBoundaryMovement[] = [];
    for (
      let iteration = 1;
      iteration < negotiated.snapshots.length;
      iteration += 1
    ) {
      const before = negotiated.snapshots[iteration - 1]!;
      const after = negotiated.snapshots[iteration]!;
      for (let index = 0; index < majorLineageIds.length; index += 1) {
        const territoryId = asTerritoryId(
          `territory:${majorLineageIds[index] as PersonId}`,
        );
        const areaBefore = polygonArea(before[index] as Polygon);
        const areaAfter = polygonArea(after[index] as Polygon);
        movements.push(
          Object.freeze({
            iteration,
            territoryId,
            before: before[index] as Polygon,
            after: after[index] as Polygon,
            areaBefore: roundDeterministic(areaBefore, decimalPlaces),
            areaAfter: roundDeterministic(areaAfter, decimalPlaces),
            transferredArea: roundDeterministic(
              areaAfter - areaBefore,
              decimalPlaces,
            ),
          }),
        );
      }
    }
    const preliminaryTerritories: Territory[] = negotiated.cells.map(
      (cell, index) => {
        const lineageId = majorLineageIds[index] as PersonId;
        const area = polygonArea(cell);
        const clearancePolygon = insetConvexPolygon(
          cell,
          input.configuration.corridorClearance,
          epsilon,
        );
        return Object.freeze({
          id: asTerritoryId(`territory:${lineageId}`),
          ownerLineageRootId: lineageId,
          parentTerritoryId: null,
          parentOwnerId: input.selectedRootId,
          polygon: canonicalizePolygon(cell, decimalPlaces),
          centroid: polygonCentroid(cell),
          area: roundDeterministic(area, decimalPlaces),
          requiredArea: roundDeterministic(
            requiredAreas[index] as number,
            decimalPlaces,
          ),
          allocatedShare: roundDeterministic(
            area / territoryAvailableArea,
            decimalPlaces,
          ),
          demandShare: roundDeterministic(
            demandShares[index] as number,
            decimalPlaces,
          ),
          boundaryMargin: input.configuration.boundaryMargin,
          clearanceEnvelope: Object.freeze({
            inset: input.configuration.corridorClearance,
            polygon: canonicalizePolygon(clearancePolygon, decimalPlaces),
          }),
          junctionZoneId: `junction:${lineageId}`,
          entryCorridorId: asCorridorId(`corridor:${lineageId}`),
          childTerritoryIds: Object.freeze([]),
          fragmentCount: 1 as const,
        });
      },
    );
    const corridorResult = planGrowthCorridors(
      preliminaryTerritories,
      prepared.rootEntryReservation,
      prepared.templatePolygon,
      input.configuration,
    );
    addDiagnostic({
      stage: "CORRIDOR_PLANNING",
      code: "CORRIDORS_PLANNED",
      metrics: {
        corridorCount: corridorResult.corridors.length,
        impossibleCount: corridorResult.impossibleOwnerIds.length,
      },
      ...(corridorResult.impossibleOwnerIds.length === 0
        ? {}
        : { rejectionReason: "CORRIDOR_IMPOSSIBLE" as const }),
    });
    const negotiation: TerritoryNegotiationState = Object.freeze({
      status:
        negotiated.iterations === 0
          ? "NOT_REQUIRED"
          : negotiated.converged
            ? "CONVERGED"
            : "FAILED",
      iterations: negotiated.iterations,
      maximumIterations: input.configuration.maxNegotiationIterations,
      finalMaximumAreaErrorRatio: roundDeterministic(
        negotiated.maximumAreaErrorRatio,
        decimalPlaces,
      ),
      movements: Object.freeze(movements),
      convergenceReason:
        negotiated.iterations === 0 && negotiated.converged
          ? "INITIAL_PLAN_VALID"
          : negotiated.converged
            ? "AREA_TARGET_REACHED"
            : "ITERATION_LIMIT",
    });
    addDiagnostic({
      stage: "NEGOTIATION",
      code: negotiated.converged
        ? "NEGOTIATION_CONVERGED"
        : "NEGOTIATION_FAILED",
      metrics: {
        iterations: negotiated.iterations,
        finalMaximumAreaErrorRatio: negotiated.maximumAreaErrorRatio,
      },
      ...(negotiated.converged
        ? {}
        : { rejectionReason: "NEGOTIATION_DID_NOT_CONVERGE" as const }),
    });
    const serializableCandidate = {
      territories: preliminaryTerritories,
      corridors: corridorResult.corridors,
      junctionZones: corridorResult.junctionZones,
      negotiation,
      diagnostics,
    };
    let validation = new TerritoryValidator().validate({
      selectedRootId: input.selectedRootId,
      majorLineageIds,
      templatePolygon: prepared.templatePolygon,
      rootEntryReservation: prepared.rootEntryReservation,
      territories: preliminaryTerritories,
      corridors: corridorResult.corridors,
      junctionZones: corridorResult.junctionZones,
      configuration: input.configuration,
      serializableCandidate,
    });
    const blocking: EngineIssue[] = [];
    if (!negotiated.converged) {
      blocking.push(
        problem(
          "TERRITORY_NEGOTIATION_FAILED",
          "NEGOTIATE_TERRITORIES",
          {
            iterations: negotiated.iterations,
            maximumAreaErrorRatio: negotiated.maximumAreaErrorRatio,
          },
          majorLineageIds,
        ),
      );
    }
    if (corridorResult.impossibleOwnerIds.length > 0) {
      blocking.push(
        problem(
          "CORRIDOR_INVALID",
          "PLAN_CORRIDORS",
          { reason: "Unable to place a contained junction reservation" },
          corridorResult.impossibleOwnerIds,
        ),
      );
    }
    validation = mergeValidation(validation, blocking);
    addDiagnostic({
      stage: "VALIDATION",
      code: validation.accepted
        ? "TERRITORY_PLAN_ACCEPTED"
        : "TERRITORY_PLAN_REJECTED",
      metrics: {
        issueCount: validation.issues.length,
        territoryCount: preliminaryTerritories.length,
        corridorCount: corridorResult.corridors.length,
      },
      ...(validation.accepted
        ? {}
        : { rejectionReason: "INVALID_POLYGON" as const }),
    });
    if (!validation.accepted) {
      return stageFailure(
        validation.issues,
        input.diagnostics?.snapshot() ?? [],
      );
    }
    const fingerprintInput = {
      selectedRootId: input.selectedRootId,
      sourceChecksum: input.sourceChecksum,
      seed: input.seed,
      templateBoundary: input.templateBoundary,
      templatePolygon: prepared.templatePolygon,
      rootEntryReservation: prepared.rootEntryReservation,
      territories: preliminaryTerritories,
      corridors: corridorResult.corridors,
      junctionZones: corridorResult.junctionZones,
      negotiation,
      diagnostics,
      validation,
      configurationUsed: input.configuration,
      demandFingerprint:
        input.demandPlan.computationMetadata.deterministicFingerprint,
    };
    const deterministicFingerprint = await sha256Canonical(fingerprintInput);
    const plan: TerritoryPlan = Object.freeze({
      schemaVersion: "1.0",
      engineVersion: "0.2.0",
      territoryPlanId: asTerritoryPlanId(
        `territory:${deterministicFingerprint.slice(0, 24)}`,
      ),
      status: "ACCEPTED",
      selectedRootId: input.selectedRootId,
      sourceChecksum: input.sourceChecksum,
      seed: input.seed,
      templateBoundary: input.templateBoundary,
      templatePolygon: prepared.templatePolygon,
      usableBounds: boundsFromPoints(prepared.territoryPolygon.points),
      rootEntryReservation: prepared.rootEntryReservation,
      territories: Object.freeze(preliminaryTerritories),
      junctionZones: corridorResult.junctionZones,
      corridors: corridorResult.corridors,
      negotiation,
      diagnostics: Object.freeze(diagnostics),
      validation,
      configurationUsed: Object.freeze({ ...input.configuration }),
      demandFingerprint:
        input.demandPlan.computationMetadata.deterministicFingerprint,
      deterministicFingerprint,
    });
    input.diagnostics?.emit({
      stage: "VALIDATE_TERRITORIES",
      eventType: "STAGE_END",
      entityId: input.selectedRootId,
      metrics: {
        territoryCount: plan.territories.length,
        corridorCount: plan.corridors.length,
        negotiationIterations: plan.negotiation.iterations,
      },
    });
    return stageSuccess(plan, input.diagnostics?.snapshot() ?? []);
  }
}
