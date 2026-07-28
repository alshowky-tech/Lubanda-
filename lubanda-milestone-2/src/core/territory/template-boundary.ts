import { boundsFromPoints } from "../geometry/bounds.js";
import { classifyPointInPolygon } from "../geometry/polygon.js";
import type { Bounds, Polygon, Vec2 } from "../geometry/types.js";
import {
  canonicalizePolygon,
  clipPolygonByHalfPlane,
  insetConvexPolygon,
  isConvexPolygon,
  polygonContainsPolygon,
} from "./polygon-geometry.js";
import type {
  RootEntryReservation,
  TemplateBoundary,
} from "./types.js";
import type { PersonId } from "../contracts/identifiers.js";
import type { TerritoryConfig } from "../config/types.js";

export const templateToPolygon = (
  boundary: TemplateBoundary,
  sampleCount: number,
  decimalPlaces: number,
): Polygon => {
  if (boundary.kind === "POLYGON") {
    return canonicalizePolygon(boundary.polygon, decimalPlaces);
  }
  if (boundary.kind === "ELLIPSE") {
    return canonicalizePolygon(
      {
        points: Array.from({ length: sampleCount }, (_, index) => {
          const angle = (Math.PI * 2 * index) / sampleCount;
          return {
            x: boundary.center.x + Math.cos(angle) * boundary.radiusX,
            y: boundary.center.y + Math.sin(angle) * boundary.radiusY,
          };
        }),
      },
      decimalPlaces,
    );
  }
  const parameters = boundary.parameters;
  const arcCount = Math.max(8, Math.floor(sampleCount / 2));
  const points: Vec2[] = [
    {
      x: parameters.centerX - parameters.radiusX,
      y: parameters.baselineY - parameters.rootZoneDepth,
    },
    {
      x: parameters.centerX + parameters.radiusX,
      y: parameters.baselineY - parameters.rootZoneDepth,
    },
    {
      x: parameters.centerX + parameters.radiusX,
      y: parameters.baselineY,
    },
  ];
  for (let index = 1; index <= arcCount; index += 1) {
    const angle = (Math.PI * index) / arcCount;
    points.push({
      x: parameters.centerX + Math.cos(angle) * parameters.radiusX,
      y: parameters.baselineY + Math.sin(angle) * parameters.radiusY,
    });
  }
  return canonicalizePolygon({ points }, decimalPlaces);
};

export interface PreparedTemplate {
  readonly templatePolygon: Polygon;
  readonly territoryPolygon: Polygon;
  readonly rootEntryReservation: RootEntryReservation;
  readonly bounds: Bounds;
}

export const prepareTemplate = (
  boundary: TemplateBoundary,
  ownerRootId: PersonId,
  configuration: TerritoryConfig,
  epsilon: number,
): PreparedTemplate | null => {
  const templatePolygon = templateToPolygon(
    boundary,
    configuration.boundarySamplingPoints,
    configuration.roundingDecimalPlaces,
  );
  if (!isConvexPolygon(templatePolygon, epsilon)) return null;
  const bounds = boundsFromPoints(templatePolygon.points);
  const halfWidth = configuration.rootEntryWidth / 2;
  const halfDepth = configuration.rootEntryDepth / 2;
  const centerX = (bounds.minX + bounds.maxX) / 2;
  let reservation: RootEntryReservation | null = null;
  const step = Math.max(1, configuration.boundaryMargin / 4);
  for (
    let centerY =
      bounds.minY + configuration.boundaryMargin + halfDepth;
    centerY + halfDepth <= bounds.maxY - configuration.boundaryMargin;
    centerY += step
  ) {
    const polygon: Polygon = {
      points: [
        { x: centerX - halfWidth, y: centerY - halfDepth },
        { x: centerX + halfWidth, y: centerY - halfDepth },
        { x: centerX + halfWidth, y: centerY + halfDepth },
        { x: centerX - halfWidth, y: centerY + halfDepth },
      ],
    };
    if (polygonContainsPolygon(templatePolygon, polygon)) {
      reservation = {
        id: "root-entry",
        ownerRootId,
        polygon: canonicalizePolygon(
          polygon,
          configuration.roundingDecimalPlaces,
        ),
        center: { x: centerX, y: centerY },
        width: configuration.rootEntryWidth,
        depth: configuration.rootEntryDepth,
        boundaryMargin: configuration.boundaryMargin,
      };
      break;
    }
  }
  if (!reservation) return null;
  const inset = insetConvexPolygon(
    templatePolygon,
    configuration.boundaryMargin,
    epsilon,
  );
  if (inset.points.length < 3) return null;
  const minimumTerritoryY =
    reservation.center.y +
    reservation.depth / 2 +
    configuration.corridorClearance;
  const territoryPolygon = canonicalizePolygon(
    clipPolygonByHalfPlane(
      inset,
      { x: 0, y: -1 },
      -minimumTerritoryY,
      epsilon,
    ),
    configuration.roundingDecimalPlaces,
  );
  if (
    territoryPolygon.points.length < 3 ||
    classifyPointInPolygon(reservation.center, templatePolygon) === "OUTSIDE"
  ) {
    return null;
  }
  return { templatePolygon, territoryPolygon, rootEntryReservation: reservation, bounds };
};

