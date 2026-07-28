import { stableUnit } from "../determinism/numeric.js";
import { distance } from "../geometry/vec2.js";
import type { Vec2 } from "../geometry/types.js";
import type {
  AttractorField,
  AttractorPoint,
} from "./types.js";

/**
 * Seeded deterministic attractor points that pull branches toward organic
 * growth patterns. Attractors are placed near territory centroids and
 * along natural growth axes. Repulsors push branches away from boundaries
 * and other branches to maintain clearance.
 */
export const buildAttractorField = (
  entryPoint: Vec2,
  templateBoundsMin: Vec2,
  templateBoundsMax: Vec2,
  territoryCentroids: readonly Vec2[],
  seed: number,
): AttractorField => {
  const attractors: AttractorPoint[] = [];

  // Primary attractor: upward growth from the root entry
  const upwardPull: Vec2 = {
    x: entryPoint.x + (stableUnit("attractor-upward-x", seed) * 2 - 1) * 12,
    y: templateBoundsMin.y + (templateBoundsMax.y - templateBoundsMin.y) * 0.15,
  };
  attractors.push({
    point: upwardPull,
    strength: 0.6,
    falloff: 0.3,
  });

  // Secondary attractor: center of the template
  const centerX = (templateBoundsMin.x + templateBoundsMax.x) / 2;
  const centerY = (templateBoundsMin.y + templateBoundsMax.y) / 2;
  attractors.push({
    point: { x: centerX, y: centerY },
    strength: 0.4,
    falloff: 0.5,
  });

  // Attractors near each territory centroid
  for (let index = 0; index < territoryCentroids.length; index += 1) {
    const centroid = territoryCentroids[index] as Vec2;
    const jitterX = (stableUnit(`attractor-tc-x-${index}`, seed) * 2 - 1) * 24;
    const jitterY = (stableUnit(`attractor-tc-y-${index}`, seed) * 2 - 1) * 24;
    attractors.push({
      point: {
        x: centroid.x + jitterX,
        y: centroid.y + jitterY,
      },
      strength: 0.35 + (stableUnit(`attractor-str-${index}`, seed) * 0.15),
      falloff: 0.4,
    });
  }

  // Upper-region attractor for canopy spread
  attractors.push({
    point: {
      x: centerX + (stableUnit("attractor-canopy-x", seed) * 2 - 1) * centerX * 0.15,
      y: templateBoundsMax.y * 0.85,
    },
    strength: 0.25,
    falloff: 0.6,
  });

  // Repulsors: push away from boundaries
  const repulsors: AttractorPoint[] = [
    {
      point: { x: templateBoundsMin.x, y: centerY },
      strength: 0.3,
      falloff: 0.7,
    },
    {
      point: { x: templateBoundsMax.x, y: centerY },
      strength: 0.3,
      falloff: 0.7,
    },
  ];

  return {
    attractors: Object.freeze(attractors),
    repulsors: Object.freeze(repulsors),
  };
};

/**
 * Compute the net attractor influence at a given point.
 * Returns a direction vector that draws branches toward organic growth paths.
 */
export const computeAttractorForce = (
  point: Vec2,
  field: AttractorField,
  seed: number,
  epsilon = 1e-9,
): Vec2 => {
  let totalForceX = 0;
  let totalForceY = 0;

  for (const attractor of field.attractors) {
    const dist = Math.max(distance(point, attractor.point), epsilon);
    const influence =
      attractor.strength / (1 + dist * attractor.falloff);
    totalForceX +=
      ((attractor.point.x - point.x) / dist) * influence;
    totalForceY +=
      ((attractor.point.y - point.y) / dist) * influence;
  }

  for (const repulsor of field.repulsors) {
    const dist = Math.max(distance(point, repulsor.point), epsilon);
    const influence =
      repulsor.strength / (1 + dist * repulsor.falloff);
    totalForceX -=
      ((repulsor.point.x - point.x) / dist) * influence;
    totalForceY -=
      ((repulsor.point.y - point.y) / dist) * influence;
  }

  // Add seeded noise for organic variation
  const noiseX = (stableUnit(`attractor-noise-x-${point.x}-${point.y}`, seed) * 2 - 1) * 0.04;
  const noiseY = (stableUnit(`attractor-noise-y-${point.x}-${point.y}`, seed) * 2 - 1) * 0.04;

  const magnitude = Math.hypot(totalForceX + noiseX, totalForceY + noiseY);
  if (magnitude <= epsilon) return { x: 0, y: 0 };

  return {
    x: (totalForceX + noiseX) / magnitude,
    y: (totalForceY + noiseY) / magnitude,
  };
};
