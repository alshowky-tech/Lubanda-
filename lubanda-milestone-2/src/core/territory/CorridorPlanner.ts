import {
  asCorridorId,
  type PersonId,
  type TerritoryId,
} from "../contracts/index.js";
import { distance } from "../geometry/vec2.js";
import type { Polygon, Vec2 } from "../geometry/types.js";
import {
  canonicalizePolygon,
  circlePolygon,
  polygonContainsPolygon,
} from "./polygon-geometry.js";
import type {
  GrowthCorridor,
  ReservedJunctionZone,
  RootEntryReservation,
  Territory,
} from "./types.js";
import type { TerritoryConfig } from "../config/types.js";

const interpolate = (start: Vec2, end: Vec2, ratio: number): Vec2 => ({
  x: start.x + (end.x - start.x) * ratio,
  y: start.y + (end.y - start.y) * ratio,
});

const polylineLength = (points: readonly Vec2[]): number =>
  points.slice(1).reduce(
    (total, point, index) =>
      total + distance(points[index] as Vec2, point),
    0,
  );

export interface CorridorPlanningResult {
  readonly corridors: readonly GrowthCorridor[];
  readonly junctionZones: readonly ReservedJunctionZone[];
  readonly impossibleOwnerIds: readonly PersonId[];
}

export const planGrowthCorridors = (
  territories: readonly Territory[],
  rootEntry: RootEntryReservation,
  templatePolygon: Polygon,
  configuration: TerritoryConfig,
): CorridorPlanningResult => {
  const corridors: GrowthCorridor[] = [];
  const junctionZones: ReservedJunctionZone[] = [];
  const impossibleOwnerIds: PersonId[] = [];
  for (const territory of territories) {
    let ratio = 0.22;
    let junctionCenter = interpolate(
      rootEntry.center,
      territory.centroid,
      ratio,
    );
    let junctionPolygon = circlePolygon(
      junctionCenter,
      configuration.junctionZoneRadius,
      Math.max(12, Math.floor(configuration.boundarySamplingPoints / 4)),
    );
    while (
      ratio < 0.85 &&
      !polygonContainsPolygon(templatePolygon, junctionPolygon)
    ) {
      ratio += 0.05;
      junctionCenter = interpolate(
        rootEntry.center,
        territory.centroid,
        ratio,
      );
      junctionPolygon = circlePolygon(
        junctionCenter,
        configuration.junctionZoneRadius,
        Math.max(12, Math.floor(configuration.boundarySamplingPoints / 4)),
      );
    }
    if (!polygonContainsPolygon(templatePolygon, junctionPolygon)) {
      impossibleOwnerIds.push(territory.ownerLineageRootId);
      continue;
    }
    const junctionZoneId = `junction:${territory.ownerLineageRootId}`;
    const corridorId = asCorridorId(
      `corridor:${territory.ownerLineageRootId}`,
    );
    const centerline = Object.freeze([
      rootEntry.center,
      junctionCenter,
      territory.centroid,
    ]);
    junctionZones.push(
      Object.freeze({
        id: junctionZoneId,
        ownerLineageRootId: territory.ownerLineageRootId,
        center: junctionCenter,
        radius: configuration.junctionZoneRadius,
        polygon: canonicalizePolygon(
          junctionPolygon,
          configuration.roundingDecimalPlaces,
        ),
      }),
    );
    corridors.push(
      Object.freeze({
        id: corridorId,
        ownerLineageRootId: territory.ownerLineageRootId,
        fromReservationId: "root-entry",
        toTerritoryId: territory.id as TerritoryId,
        viaJunctionZoneId: junctionZoneId,
        entryPoint: rootEntry.center,
        exitPoint: territory.centroid,
        centerline,
        width: configuration.minimumCorridorWidth,
        usableLength: polylineLength(centerline),
        clearance: configuration.corridorClearance,
        reservationMode: "EASEMENT",
      }),
    );
  }
  return {
    corridors: Object.freeze(corridors),
    junctionZones: Object.freeze(junctionZones),
    impossibleOwnerIds: Object.freeze(impossibleOwnerIds),
  };
};
