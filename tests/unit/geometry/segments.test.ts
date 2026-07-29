import {
  intersectSegments,
  pointSegmentDistance,
} from "../../../src/core/geometry/segments.js";

describe("segment predicates", () => {
  it("classifies a proper intersection", () => {
    const result = intersectSegments(
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
    );
    expect(result).toEqual({ kind: "PROPER", point: { x: 5, y: 5 } });
  });

  it("classifies non-intersection", () => {
    expect(
      intersectSegments(
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 0, y: 5 },
        { x: 5, y: 5 },
      ).kind,
    ).toBe("NONE");
  });

  it("classifies endpoint touching", () => {
    expect(
      intersectSegments(
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 5 },
      ),
    ).toEqual({ kind: "ENDPOINT_TOUCH", point: { x: 5, y: 0 } });
  });

  it("classifies collinear touch and overlap", () => {
    expect(
      intersectSegments(
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ).kind,
    ).toBe("COLLINEAR_TOUCH");
    expect(
      intersectSegments(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 4, y: 0 },
        { x: 12, y: 0 },
      ),
    ).toEqual({
      kind: "COLLINEAR_OVERLAP",
      overlap: [
        { x: 4, y: 0 },
        { x: 10, y: 0 },
      ],
    });
  });

  it("classifies degenerate touching", () => {
    expect(
      intersectSegments(
        { x: 2, y: 0 },
        { x: 2, y: 0 },
        { x: 0, y: 0 },
        { x: 5, y: 0 },
      ).kind,
    ).toBe("DEGENERATE_TOUCH");
  });

  it("computes point-segment distance", () => {
    expect(
      pointSegmentDistance({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 }),
    ).toBe(3);
  });
});

