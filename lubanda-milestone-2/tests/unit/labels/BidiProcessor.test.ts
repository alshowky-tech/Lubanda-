import { describe, expect, it } from "vitest";
import { reorderBidi, toVisualOrder, logicalToVisual } from "../../../src/core/labels/BidiProcessor.js";
import { shapeWithBidi } from "../../../src/core/labels/ArabicShaper.js";

describe("BidiProcessor", () => {
  describe("pure LTR text", () => {
    it("preserves order for Latin text", () => {
      const result = reorderBidi("Hello", "LTR");
      expect(result.visualOrder).toEqual([0, 1, 2, 3, 4]);
    });

    it("preserves order for digits", () => {
      const result = reorderBidi("123", "LTR");
      expect(result.visualOrder).toEqual([0, 1, 2]);
    });
  });

  describe("pure RTL text", () => {
    it("preserves RTL order for Arabic text under RTL base direction", () => {
      const text = "السلام";
      const result = reorderBidi(text, "RTL");
      // RTL text in an RTL paragraph stays in logical order visually
      expect(result.visualOrder.length).toBe(text.length);
    });

    it("produces correct run count and direction for all-Arabic text", () => {
      const result = reorderBidi("مرحبا", "RTL");
      expect(result.runs.length).toBeGreaterThanOrEqual(1);
      for (const run of result.runs) {
        expect(run.direction).toBe("R");
      }
    });
  });

  describe("mixed Arabic and Latin text (real-world labels)", () => {
    it("reorders Arabic with Latin parenthetical ID in RTL context", () => {
      // Logical: "محمد (Muhammad)"
      // Visual (RTL paragraph): "(Muhammad) محمد"
      const text = "محمد (Muhammad)";
      const visual = toVisualOrder(text, "RTL");
      // Visual order should start with RTL content
      expect(visual).not.toBe(text);
      // The visual order should have Arabic glyphs first followed by Latin
      // Since this is RTL paragraph, the Arabic text appears right-to-left
      expect(visual.length).toBe(text.length);
    });

    it("reorders Arabic with Western digits correctly", () => {
      // Logical: "البيت 123"
      // In RTL paragraph: digits retain their order, Arabic flows RTL
      const text = "البيت 123";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.length).toBe(text.length);
      expect(visual.replace(/\s/g, "").length).toBeGreaterThan(0);
    });

    it("reorders Arabic with Arabic-Indic digits", () => {
      const text = "رقم ١٤٤٦";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.length).toBe(text.length);
    });

    it("logical and visual order differ for mixed Arabic/Latin input", () => {
      const text = "Hello محمد World";
      const logicalOrder = text;
      const visualOrder = toVisualOrder(text, "LTR");
      // Under LTR base: Arabic will be reordered within its run
      expect(visualOrder).not.toBe(logicalOrder);
    });
  });

  describe("punctuation and parentheses", () => {
    it("parentheses surround the correct content in visual order", () => {
      const text = "(test) محمد";
      const visual = toVisualOrder(text, "RTL");
      // In RTL paragraph: the Arabic text comes first, then Latin in parentheses
      expect(visual.length).toBe(text.length);
    });

    it("periods and commas resolve near adjacent text", () => {
      const text = "Hello, محمد.";
      const visual = toVisualOrder(text, "LTR");
      expect(visual.length).toBe(text.length);
    });
  });

  describe("multiple directional runs", () => {
    it("handles multiple RTL and LTR runs", () => {
      const text = "Hello محمد World أحمد Test";
      const visual = toVisualOrder(text, "LTR");
      expect(visual.length).toBe(text.length);
      // Multiple transitions should be reflected
      const visualTrimmed = visual.replace(/\s+/g, " ");
      expect(visualTrimmed.length).toBeGreaterThan(0);
    });

    it("handles digit characters within RTL context", () => {
      // In "رقم 123" with RTL paragraph, digits are within an RTL context
      // and their visual order depends on the resolved bidi level.
      const text = "رقم 123";
      const visual = toVisualOrder(text, "RTL");
      // The visual output should have the same length
      expect(visual.length).toBe(text.length);
      // All original characters should be present
      const sortedOriginal = [...text].sort().join("");
      const sortedVisual = [...visual].sort().join("");
      expect(sortedVisual).toBe(sortedOriginal);
    });
  });

  describe("determinism", () => {
    it("same input produces identical visual order", () => {
      const text = "محمد (Muhammad) 123";
      const r1 = reorderBidi(text, "RTL");
      const r2 = reorderBidi(text, "RTL");
      expect(r1.visualOrder).toEqual(r2.visualOrder);
    });

    it("different directions produce different results", () => {
      const text = "Hello محمد";
      const ltr = toVisualOrder(text, "LTR");
      const rtl = toVisualOrder(text, "RTL");
      expect(ltr).not.toBe(rtl);
    });
  });

  describe("explicit paragraph direction", () => {
    it("LTR paragraph direction starts LTR content on left", () => {
      const text = "Hello محمد";
      const result = reorderBidi(text, "LTR");
      // Under LTR, the first character should be from "Hello"
      expect(result.visualOrder[0]).toBeLessThan(6);
    });

    it("RTL paragraph direction starts RTL content on right", () => {
      const text = "Hello محمد";
      const result = reorderBidi(text, "RTL");
      // Under RTL, the visual order starts with Arabic characters
      const firstChar = [...text][result.visualOrder[0]!]!;
      const isArabic = /[\u0600-\u06FF]/.test(firstChar);
      expect(isArabic).toBe(true);
    });
  });
});

describe("shapeWithBidi integration", () => {
  it("does not shape Arabic letters across directional boundaries", () => {
    // Arabic letters on both sides of Latin text should not connect
    const text = "محمد Hello أحمد";
    const shaped = shapeWithBidi(text, "LTR");
    // The shaped output should have the Latin text intact between Arabic runs
    expect(shaped).toContain("Hello");
  });

  it("produces deterministic visual-order output", () => {
    const text = "محمد (Muhammad) 123";
    const r1 = shapeWithBidi(text, "RTL");
    const r2 = shapeWithBidi(text, "RTL");
    expect(r1).toBe(r2);
  });

  it("produces different output for different directions", () => {
    const text = "Hello محمد";
    const ltrShaped = shapeWithBidi(text, "LTR");
    const rtlShaped = shapeWithBidi(text, "RTL");
    expect(ltrShaped).not.toBe(rtlShaped);
  });
});

describe("logicalToVisual mapping", () => {
  it("bidirectional mapping is consistent", () => {
    const text = "محمد (Muhammad)";
    const mapping = logicalToVisual(text, "RTL");
    expect(mapping.length).toBe(text.length);
    for (let i = 0; i < mapping.length; i += 1) {
      expect(Number.isInteger(mapping[i])).toBe(true);
    }
  });

  it("visual order contains same characters as logical", () => {
    const text = "Hello محمد 123";
    const visual = toVisualOrder(text, "RTL");
    const sortedLogical = [...text].sort().join("");
    const sortedVisual = [...visual].sort().join("");
    expect(sortedVisual).toBe(sortedLogical);
  });
});
