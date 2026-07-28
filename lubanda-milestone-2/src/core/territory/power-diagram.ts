import { boundsFromPoints } from "../geometry/bounds.js";
import { classifyPointInPolygon } from "../geometry/polygon.js";
import type { Polygon, Vec2 } from "../geometry/types.js";
import { stableUnit } from "../determinism/numeric.js";
import {
  canonicalizePolygon,
  clipPolygonByHalfPlane,
  polygonArea,
  polygonCentroid,
} from "./polygon-geometry.js";

export interface PowerSite {
  readonly key: string;
  readonly point: Vec2;
  readonly weight: number;
}

export const createDeterministicSites = (
  keys: readonly string[],
  demandShares: readonly number[],
  polygon: Polygon,
  seed: number,
  jitter: number,
): readonly PowerSite[] => {
  const bounds = boundsFromPoints(polygon.points);
  const center = polygonCentroid(polygon);
  let cumulative = 0;
  return keys.map((key, index) => {
    const share = demandShares[index] as number;
    const quantile = cumulative + share / 2;
    cumulative += share;
    const jitterX = (stableUnit(`site-x:${key}`, seed) * 2 - 1) * jitter;
    const jitterY = (stableUnit(`site-y:${key}`, seed) * 2 - 1) * jitter;
    let point: Vec2 = {
      x: bounds.minX + (bounds.maxX - bounds.minX) * Math.max(0.05, Math.min(0.95, quantile + jitterX * share)),
      y: center.y + (bounds.maxY - bounds.minY) * jitterY * 0.35,
    };
    for (let attempt = 0; attempt < 12; attempt += 1) {
      if (classifyPointInPolygon(point, polygon) !== "OUTSIDE") break;
      point = {
        x: (point.x + center.x) / 2,
        y: (point.y + center.y) / 2,
      };
    }
    return { key, point, weight: 0 };
  });
};

export const computePowerCells = (
  boundary: Polygon,
  sites: readonly PowerSite[],
  epsilon: number,
  decimalPlaces: number,
): readonly Polygon[] =>
  sites.map((site, siteIndex) => {
    let cell = boundary;
    for (let otherIndex = 0; otherIndex < sites.length; otherIndex += 1) {
      if (siteIndex === otherIndex) continue;
      const other = sites[otherIndex] as PowerSite;
      const normal = {
        x: 2 * (other.point.x - site.point.x),
        y: 2 * (other.point.y - site.point.y),
      };
      const offset =
        other.point.x ** 2 +
        other.point.y ** 2 -
        site.point.x ** 2 -
        site.point.y ** 2 +
        site.weight -
        other.weight;
      cell = clipPolygonByHalfPlane(cell, normal, offset, epsilon);
      if (cell.points.length < 3) break;
    }
    return canonicalizePolygon(cell, decimalPlaces);
  });

export interface PowerNegotiationResult {
  readonly cells: readonly Polygon[];
  readonly sites: readonly PowerSite[];
  readonly iterations: number;
  readonly maximumAreaErrorRatio: number;
  readonly converged: boolean;
  readonly snapshots: readonly (readonly Polygon[])[];
}

/**
 * Deterministic safety fallback for difficult power-diagram negotiations.
 * It transfers contiguous area along a seeded oblique axis. Every result is a
 * convex, single-fragment two-dimensional polygon; it is not a generation band
 * or an angular/radial allocation.
 */
export const partitionConvexPolygonByDemand = (
  boundary: Polygon,
  targetAreas: readonly number[],
  seed: number,
  epsilon: number,
  decimalPlaces: number,
): readonly Polygon[] => {
  const slope = (stableUnit("territory-transfer-axis", seed) * 2 - 1) * 0.22;
  const normal = { x: 1, y: slope };
  const projections = boundary.points.map(
    (point) => point.x * normal.x + point.y * normal.y,
  );
  const globalMinimum = Math.min(...projections);
  const globalMaximum = Math.max(...projections);
  let remainder = boundary;
  let previousCut = globalMinimum - 1;
  const cells: Polygon[] = [];
  for (let index = 0; index < targetAreas.length; index += 1) {
    if (index === targetAreas.length - 1) {
      cells.push(canonicalizePolygon(remainder, decimalPlaces));
      break;
    }
    const target = targetAreas[index] as number;
    let low = previousCut;
    let high = globalMaximum + 1;
    let selected = low;
    for (let iteration = 0; iteration < 64; iteration += 1) {
      const middle = (low + high) / 2;
      const candidate = clipPolygonByHalfPlane(
        remainder,
        normal,
        middle,
        epsilon,
      );
      if (polygonArea(candidate) < target) low = middle;
      else high = middle;
      selected = (low + high) / 2;
    }
    const cell = clipPolygonByHalfPlane(
      remainder,
      normal,
      selected,
      epsilon,
    );
    cells.push(canonicalizePolygon(cell, decimalPlaces));
    remainder = clipPolygonByHalfPlane(
      remainder,
      { x: -normal.x, y: -normal.y },
      -selected,
      epsilon,
    );
    previousCut = selected;
  }
  return Object.freeze(cells);
};

export const negotiatePowerCells = (
  boundary: Polygon,
  initialSites: readonly PowerSite[],
  targetAreas: readonly number[],
  maximumIterations: number,
  acceptedErrorRatio: number,
  convergenceTolerance: number,
  epsilon: number,
  decimalPlaces: number,
): PowerNegotiationResult => {
  let sites = initialSites.map((site) => ({ ...site }));
  let cells = computePowerCells(boundary, sites, epsilon, decimalPlaces);
  const snapshots: Array<readonly Polygon[]> = [cells];
  const bounds = boundsFromPoints(boundary.points);
  const scaleSquared =
    (bounds.maxX - bounds.minX) ** 2 + (bounds.maxY - bounds.minY) ** 2;
  let previousMaximumError = Number.POSITIVE_INFINITY;
  let maximumAreaErrorRatio = Number.POSITIVE_INFINITY;
  for (let iteration = 0; iteration <= maximumIterations; iteration += 1) {
    const areas = cells.map(polygonArea);
    const errors = areas.map((area, index) => {
      const target = targetAreas[index] as number;
      return target <= epsilon ? 0 : (target - area) / target;
    });
    maximumAreaErrorRatio = Math.max(...errors.map(Math.abs), 0);
    if (maximumAreaErrorRatio <= acceptedErrorRatio) {
      return {
        cells,
        sites,
        iterations: iteration,
        maximumAreaErrorRatio,
        converged: true,
        snapshots,
      };
    }
    if (iteration === maximumIterations) break;
    const improvement = previousMaximumError - maximumAreaErrorRatio;
    const learningRate =
      improvement >= 0 && improvement < convergenceTolerance ? 0.08 : 0.18;
    sites = sites.map((site, index) => ({
      ...site,
      weight:
        site.weight +
        (errors[index] as number) * scaleSquared * learningRate,
    }));
    previousMaximumError = maximumAreaErrorRatio;
    cells = computePowerCells(boundary, sites, epsilon, decimalPlaces);
    snapshots.push(cells);
  }
  return {
    cells,
    sites,
    iterations: maximumIterations,
    maximumAreaErrorRatio,
    converged: false,
    snapshots,
  };
};
