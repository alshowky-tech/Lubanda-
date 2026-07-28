import { detectCyclePaths } from "../../../src/core/validation/cycle-detection.js";

describe("cycle detection", () => {
  it("returns the exact closed cycle path", () => {
    expect(
      detectCyclePaths([
        { id: "1", parentId: "3" },
        { id: "2", parentId: "1" },
        { id: "3", parentId: "2" },
      ]),
    ).toEqual([["1", "3", "2", "1"]]);
  });

  it("returns no path for a valid forest", () => {
    expect(
      detectCyclePaths([
        { id: "1", parentId: null },
        { id: "2", parentId: "1" },
        { id: "3", parentId: null },
      ]),
    ).toEqual([]);
  });
});

