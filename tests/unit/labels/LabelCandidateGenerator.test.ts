import { boundsInsidePolygon } from "../../../src/core/labels/LabelCandidateGenerator.js";

describe("boundsInsidePolygon", () => {
  it("accepts a label rectangle fully contained by the template", () => {
    expect(boundsInsidePolygon(
      { minX: 10, minY: 10, maxX: 20, maxY: 20 },
      { points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ] },
    )).toBe(true);
  });

  it("rejects a rectangle with an outside corner", () => {
    expect(boundsInsidePolygon(
      { minX: 95, minY: 10, maxX: 105, maxY: 20 },
      { points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 0, y: 100 },
      ] },
    )).toBe(false);
  });

  it("rejects a rectangle spanning a concave boundary notch", () => {
    expect(boundsInsidePolygon(
      { minX: 20, minY: 20, maxX: 80, maxY: 80 },
      { points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 100 },
        { x: 60, y: 100 },
        { x: 60, y: 40 },
        { x: 40, y: 40 },
        { x: 40, y: 100 },
        { x: 0, y: 100 },
      ] },
    )).toBe(false);
  });
});
