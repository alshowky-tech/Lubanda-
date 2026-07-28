import {
  add,
  distance,
  dot,
  normalize,
  scale,
  subtract,
} from "../../../src/core/geometry/vec2.js";

describe("Vec2", () => {
  it("performs vector arithmetic", () => {
    expect(add({ x: 1, y: 2 }, { x: 3, y: 4 })).toEqual({ x: 4, y: 6 });
    expect(subtract({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({ x: 2, y: 2 });
    expect(scale({ x: 2, y: -3 }, 2)).toEqual({ x: 4, y: -6 });
    expect(dot({ x: 1, y: 2 }, { x: 3, y: 4 })).toBe(11);
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it("normalizes non-zero vectors and rejects zero/non-finite vectors", () => {
    expect(normalize({ x: 3, y: 4 })).toEqual({ x: 0.6, y: 0.8 });
    expect(() => normalize({ x: 0, y: 0 })).toThrow(RangeError);
    expect(() => add({ x: Number.NaN, y: 0 }, { x: 0, y: 0 })).toThrow(TypeError);
  });
});

