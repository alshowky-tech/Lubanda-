import { classifyPointInPolygon } from "../../../src/core/geometry/polygon.js";

const square = {
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

describe("polygon containment", () => {
  it("distinguishes inside, boundary, and outside", () => {
    expect(classifyPointInPolygon({ x: 5, y: 5 }, square)).toBe("INSIDE");
    expect(classifyPointInPolygon({ x: 0, y: 5 }, square)).toBe("BOUNDARY");
    expect(classifyPointInPolygon({ x: 11, y: 5 }, square)).toBe("OUTSIDE");
  });
});

