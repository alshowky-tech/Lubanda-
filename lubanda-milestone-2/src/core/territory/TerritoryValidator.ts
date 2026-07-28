import type {
  EngineIssue,
  PersonId,
  TerritoryId,
} from "../contracts/index.js";
import { classifyPointInPolygon } from "../geometry/polygon.js";
import type { Polygon, Vec2 } from "../geometry/types.js";
import {
  intersectConvexPolygons,
  isFinitePolygon,
  isSimplePolygon,
  polygonArea,
  polygonContainsPolygon,
} from "./polygon-geometry.js";
import type {
  GrowthCorridor,
  ReservedJunctionZone,
  RootEntryReservation,
  Territory,
  TerritoryValidationReport,
} from "./types.js";
import type { TerritoryConfig } from "../config/types.js";

const issue = (
  code: EngineIssue["code"],
  details: Readonly<Record<string, unknown>>,
  entityIds: readonly string[] = [],
): EngineIssue => ({
  code,
  severity: "ERROR",
  messageKey: `territory.${code.toLocaleLowerCase("en-US")}`,
  stage: "VALIDATE_TERRITORIES",
  ...(entityIds.length === 0 ? {} : { entityIds }),
  details,
  recoverable: true,
});

const finitePoint = (point: Vec2): boolean =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const hasRuntimeCollection = (value: unknown, seen = new Set<object>()): boolean => {
  if (value instanceof Map || value instanceof Set || value instanceof WeakMap || value instanceof WeakSet) {
    return true;
  }
  if (value === null || typeof value !== "object") return false;
  if (seen.has(value)) return false;
  seen.add(value);
  return Object.values(value as Readonly<Record<string, unknown>>).some((item) =>
    hasRuntimeCollection(item, seen),
  );
};

export interface TerritoryValidationInput {
  readonly selectedRootId: PersonId;
  readonly majorLineageIds: readonly PersonId[];
  readonly templatePolygon: Polygon;
  readonly rootEntryReservation: RootEntryReservation;
  readonly territories: readonly Territory[];
  readonly corridors: readonly GrowthCorridor[];
  readonly junctionZones: readonly ReservedJunctionZone[];
  readonly configuration: TerritoryConfig;
  readonly serializableCandidate?: unknown;
}

export class TerritoryValidator {
  validate(input: TerritoryValidationInput): TerritoryValidationReport {
    const epsilon = 1e-7;
    const issues: EngineIssue[] = [];
    const owners = new Map<PersonId, Territory[]>();
    const territoryIds = new Set<TerritoryId>();
    let invalidPolygonCount = 0;
    let overlapCount = 0;
    let minimumAreaDeficitCount = 0;
    for (const territory of input.territories) {
      territoryIds.add(territory.id);
      const owned = owners.get(territory.ownerLineageRootId) ?? [];
      owned.push(territory);
      owners.set(territory.ownerLineageRootId, owned);
      if (
        !isFinitePolygon(territory.polygon) ||
        !isSimplePolygon(territory.polygon, epsilon) ||
        territory.fragmentCount !== 1 ||
        !isFinitePolygon(territory.clearanceEnvelope.polygon) ||
        !isSimplePolygon(territory.clearanceEnvelope.polygon, epsilon)
      ) {
        invalidPolygonCount += 1;
        issues.push(
          issue(
            "TERRITORY_INVALID_GEOMETRY",
            { fragmentCount: territory.fragmentCount },
            [territory.id],
          ),
        );
      }
      if (!polygonContainsPolygon(input.templatePolygon, territory.polygon)) {
        issues.push(
          issue("TERRITORY_OUT_OF_BOUNDS", {}, [territory.id]),
        );
      }
      if (
        territory.area + epsilon < territory.requiredArea ||
        territory.area + epsilon < input.configuration.minimumTerritoryArea
      ) {
        minimumAreaDeficitCount += 1;
        issues.push(
          issue(
            "TERRITORY_AREA_INSUFFICIENT",
            {
              area: territory.area,
              requiredArea: territory.requiredArea,
              configuredMinimumArea:
                input.configuration.minimumTerritoryArea,
            },
            [territory.id],
          ),
        );
      }
      if (
        territory.parentTerritoryId !== null ||
        territory.parentOwnerId !== input.selectedRootId
      ) {
        issues.push(
          issue(
            "TERRITORY_RELATION_INVALID",
            {
              parentTerritoryId: territory.parentTerritoryId,
              parentOwnerId: territory.parentOwnerId,
            },
            [territory.id],
          ),
        );
      }
    }
    let missingOwnershipCount = 0;
    for (const lineageId of input.majorLineageIds) {
      const count = owners.get(lineageId)?.length ?? 0;
      if (count === 0) {
        missingOwnershipCount += 1;
        issues.push(issue("TERRITORY_MISSING", {}, [lineageId]));
      } else if (count > 1) {
        missingOwnershipCount += 1;
        issues.push(
          issue("TERRITORY_OWNERSHIP_CONFLICT", { count }, [lineageId]),
        );
      }
    }
    for (let left = 0; left < input.territories.length; left += 1) {
      for (let right = left + 1; right < input.territories.length; right += 1) {
        const leftTerritory = input.territories[left] as Territory;
        const rightTerritory = input.territories[right] as Territory;
        const overlap = intersectConvexPolygons(
          leftTerritory.polygon,
          rightTerritory.polygon,
          epsilon,
        );
        const area = overlap.points.length < 3 ? 0 : polygonArea(overlap);
        if (area > epsilon) {
          overlapCount += 1;
          issues.push(
            issue(
              "TERRITORY_OVERLAP",
              { overlapArea: area },
              [leftTerritory.id, rightTerritory.id],
            ),
          );
        }
      }
    }
    const corridorByTerritory = new Map<TerritoryId, GrowthCorridor[]>();
    let invalidCorridorCount = 0;
    for (const corridor of input.corridors) {
      const list = corridorByTerritory.get(corridor.toTerritoryId) ?? [];
      list.push(corridor);
      corridorByTerritory.set(corridor.toTerritoryId, list);
      const finite =
        corridor.centerline.length >= 2 &&
        finitePoint(corridor.entryPoint) &&
        finitePoint(corridor.exitPoint) &&
        corridor.centerline.every(finitePoint) &&
        Number.isFinite(corridor.width) &&
        Number.isFinite(corridor.usableLength);
      if (!finite || corridor.usableLength < input.configuration.minimumCorridorLength) {
        invalidCorridorCount += 1;
        issues.push(
          issue("CORRIDOR_INVALID", { usableLength: corridor.usableLength }, [
            corridor.id,
          ]),
        );
      }
      const firstPoint = corridor.centerline[0];
      const lastPoint = corridor.centerline[corridor.centerline.length - 1];
      if (
        firstPoint === undefined ||
        lastPoint === undefined ||
        firstPoint.x !== corridor.entryPoint.x ||
        firstPoint.y !== corridor.entryPoint.y ||
        lastPoint.x !== corridor.exitPoint.x ||
        lastPoint.y !== corridor.exitPoint.y
      ) {
        invalidCorridorCount += 1;
        issues.push(
          issue("CORRIDOR_INVALID", { reason: "ENTRY_EXIT_MISMATCH" }, [
            corridor.id,
          ]),
        );
      }
      if (corridor.width < input.configuration.minimumCorridorWidth) {
        invalidCorridorCount += 1;
        issues.push(
          issue("CORRIDOR_TOO_NARROW", { width: corridor.width }, [corridor.id]),
        );
      }
      if (
        corridor.centerline.some(
          (point) =>
            classifyPointInPolygon(point, input.templatePolygon) === "OUTSIDE",
        )
      ) {
        invalidCorridorCount += 1;
        issues.push(issue("CORRIDOR_OUT_OF_BOUNDS", {}, [corridor.id]));
      }
      if (!territoryIds.has(corridor.toTerritoryId)) {
        invalidCorridorCount += 1;
        issues.push(
          issue(
            "TERRITORY_RELATION_INVALID",
            { toTerritoryId: corridor.toTerritoryId },
            [corridor.id],
          ),
        );
      }
    }
    for (const territory of input.territories) {
      if ((corridorByTerritory.get(territory.id)?.length ?? 0) !== 1) {
        invalidCorridorCount += 1;
        issues.push(issue("CORRIDOR_INVALID", { expectedCount: 1 }, [territory.id]));
      }
    }
    if (
      !polygonContainsPolygon(
        input.templatePolygon,
        input.rootEntryReservation.polygon,
      ) ||
      input.junctionZones.some(
        (zone) => !polygonContainsPolygon(input.templatePolygon, zone.polygon),
      )
    ) {
      issues.push(issue("JUNCTION_RESERVATION_VIOLATION", {}));
    }
    if (
      input.serializableCandidate !== undefined &&
      (hasRuntimeCollection(input.serializableCandidate) ||
        (() => {
          try {
            JSON.stringify(input.serializableCandidate);
            return false;
          } catch {
            return true;
          }
        })())
    ) {
      issues.push(issue("NON_SERIALIZABLE_RESULT", {}));
    }
    return {
      accepted: issues.length === 0,
      issues: Object.freeze(issues),
      metrics: {
        includedMajorLineageCount: input.majorLineageIds.length,
        territoryCount: input.territories.length,
        corridorCount: input.corridors.length,
        invalidPolygonCount,
        overlapCount,
        missingOwnershipCount,
        invalidCorridorCount,
        minimumAreaDeficitCount,
        totalAllocatedArea: input.territories.reduce(
          (total, territory) => total + territory.area,
          0,
        ),
        templateArea: polygonArea(input.templatePolygon),
      },
    };
  }
}
