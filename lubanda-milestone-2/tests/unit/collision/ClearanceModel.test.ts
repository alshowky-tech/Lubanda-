import { describe, expect, it } from "vitest";
import { computeEnvelopeRadius } from "../../../src/core/routing/ClearanceModel.js";

describe("Collision ClearanceModel — computeEnvelopeRadius", () => {
  it("computes envelope radius as sum of all terms", () => {
    const result = computeEnvelopeRadius(10, 4, 8, 2);
    expect(result).toBe(24); // 10 + 4 + 8 + 2
  });

  it("uses default safety margin when not provided", () => {
    const result = computeEnvelopeRadius(10, 4, 8);
    expect(result).toBe(26); // 10 + 4 + 8 + 4 (DEFAULT_SAFETY_MARGIN = 4)
  });

  it("returns branchHalfWidth when all allowances are zero", () => {
    const result = computeEnvelopeRadius(5, 0, 0, 0);
    expect(result).toBe(5);
  });

  it("rejects negative branchHalfWidth", () => {
    expect(() => computeEnvelopeRadius(-1, 1, 1, 1)).toThrow("branchHalfWidth");
  });

  it("rejects negative barkAllowance", () => {
    expect(() => computeEnvelopeRadius(5, -1, 1, 1)).toThrow("barkAllowance");
  });

  it("rejects negative classClearance", () => {
    expect(() => computeEnvelopeRadius(5, 1, -1, 1)).toThrow("classClearance");
  });

  it("rejects negative numericalSafetyMargin", () => {
    expect(() => computeEnvelopeRadius(5, 1, 1, -1)).toThrow("numericalSafetyMargin");
  });

  it("rejects non-finite branchHalfWidth", () => {
    expect(() => computeEnvelopeRadius(Infinity, 1, 1, 1)).toThrow("finite");
  });

  it("handles zero barkAllowance correctly for label clearance", () => {
    // Labels have no bark allowance
    const result = computeEnvelopeRadius(3, 0, 6, 2);
    expect(result).toBe(11); // 3 + 0 + 6 + 2
  });

  it("produces deterministic output (same inputs = same result)", () => {
    const a = computeEnvelopeRadius(7.5, 3.2, 5.1, 1.8);
    const b = computeEnvelopeRadius(7.5, 3.2, 5.1, 1.8);
    expect(a).toBe(b);
  });
});
