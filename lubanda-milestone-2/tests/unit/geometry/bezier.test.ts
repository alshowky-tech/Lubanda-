import {
  approximateCubicBezierLength,
  cubicBezierTangent,
  evaluateCubicBezier,
  sampleCubicBezier,
  splitCubicBezier,
} from "../../../src/core/geometry/bezier.js";

const curve = {
  p0: { x: 0, y: 0 },
  p1: { x: 0, y: 10 },
  p2: { x: 10, y: 10 },
  p3: { x: 10, y: 0 },
};

describe("cubic Bézier", () => {
  it("evaluates endpoints and tangent", () => {
    expect(evaluateCubicBezier(curve, 0)).toEqual(curve.p0);
    expect(evaluateCubicBezier(curve, 1)).toEqual(curve.p3);
    expect(cubicBezierTangent(curve, 0)).toEqual({ x: 0, y: 30 });
  });

  it("splits continuously and samples adaptively", () => {
    const [left, right] = splitCubicBezier(curve, 0.5);
    expect(left.p3).toEqual(right.p0);
    const samples = sampleCubicBezier(curve, {
      tolerance: 0.25,
      maxSubdivisionDepth: 16,
    });
    expect(samples[0]).toEqual(curve.p0);
    expect(samples.at(-1)).toEqual(curve.p3);
    expect(samples.length).toBeGreaterThan(4);
  });

  it("approximates length and validates tolerance", () => {
    expect(
      approximateCubicBezierLength(curve, {
        tolerance: 0.1,
        maxSubdivisionDepth: 16,
      }),
    ).toBeGreaterThan(10);
    expect(() =>
      sampleCubicBezier(curve, { tolerance: 0, maxSubdivisionDepth: 16 }),
    ).toThrow(TypeError);
  });
});

