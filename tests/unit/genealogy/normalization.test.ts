import {
  normalizeCanonicalText,
  normalizeId,
  normalizeSearchText,
} from "../../../src/core/genealogy/normalize.js";
import {
  normalizeDigits,
  parseStrictInteger,
} from "../../../src/core/genealogy/numerals.js";

describe("genealogy normalization", () => {
  it("stores canonical text as NFC and trims only outer whitespace", () => {
    expect(normalizeCanonicalText("  أحمد  ")).toBe("أحمد");
    expect(normalizeCanonicalText("   ")).toBeNull();
  });

  it("does not linguistically normalize IDs", () => {
    expect(normalizeId(" AbC-٠١ ")).toBe("AbC-٠١");
  });

  it("normalizes Arabic and Persian digits for strict integer parsing", () => {
    expect(normalizeDigits("١۲3")).toBe("123");
    expect(parseStrictInteger("١٣")).toBe(13);
    expect(parseStrictInteger("1.5")).toBeNull();
  });

  it("keeps search normalization separate and non-destructive", () => {
    const stored = normalizeCanonicalText("إِبْرَاهِيم");
    expect(stored).toBe("إِبْرَاهِيم");
    expect(normalizeSearchText(stored as string)).toBe("ابراهيم");
  });
});

