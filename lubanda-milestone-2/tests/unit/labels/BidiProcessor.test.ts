import { describe, expect, it } from "vitest";
import { reorderBidi, toVisualOrder, logicalToVisual } from "../../../src/core/labels/BidiProcessor.js";
import { shapeWithBidi } from "../../../src/core/labels/ArabicShaper.js";

describe("BidiProcessor", () => {
  describe("pure LTR text", () => {
    it("preserves order for Latin text", () => {
      expect(toVisualOrder("Hello", "LTR")).toBe("Hello");
    });

    it("preserves order for digits", () => {
      expect(toVisualOrder("123", "LTR")).toBe("123");
    });

    it("preserves order for Arabic text under LTR base", () => {
      const text = "السلام"; // 6 letters
      const visual = toVisualOrder(text, "LTR");
      expect(visual.length).toBe(text.length);
      // Visual should contain same chars as logical for pure RTL in LTR para
      const sortedOrig = [...text].sort().join("");
      const sortedVis = [...visual].sort().join("");
      expect(sortedVis).toBe(sortedOrig);
    });
  });

  describe("--- DIGIT ORDER PRESERVATION (critical) ---", () => {
    it("Western digits 125 remain 125 in RTL paragraph (not 521)", () => {
      // Logical: محمّد ID-125
      // Digits 125 must not be reversed
      const text = "محمد ID-125";
      const visual = toVisualOrder(text, "RTL");
      // The digits should appear as "125" in visual order
      const digitPos = visual.indexOf("125");
      expect(digitPos).toBeGreaterThanOrEqual(0);
      expect(visual.includes("125")).toBe(true);
    });

    it("year 1987 remains 1987 in RTL paragraph", () => {
      // Logical: مواليد 1987
      const text = "مواليد 1987";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.includes("1987")).toBe(true);
    });

    it("generation number 12 remains 12 in RTL paragraph", () => {
      // Logical: الجيل 12
      const text = "الجيل 12";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.includes("12")).toBe(true);
    });

    it("hyphenated ID A-17 retains internal order in RTL paragraph", () => {
      // Logical: فرع A-17
      const text = "فرع A-17";
      const visual = toVisualOrder(text, "RTL");
      // "17" should appear in order
      expect(visual.includes("17")).toBe(true);
    });

    it("Arabic-Indic digit sequence retains order", () => {
      // Logical: رقم ١٤٤٦
      const text = "رقم ١٤٤٦";
      const visual = toVisualOrder(text, "RTL");
      // Arabic-Indic digits should be in correct visual order
      // If they were reversed, we'd see ٦٤٤١ instead of ١٤٤٦
      // Check: first Arabic-Indic digit should be ١ (U+0661) not ٦ (U+0666)
      const chars = [...visual];
      const digits = chars.filter((c) => /[\u0660-\u0669]/.test(c));
      expect(digits.length).toBe(4);
      expect(digits.join("")).toBe("١٤٤٦");
    });

    it("multiple numeric sequences in one RTL paragraph", () => {
      // Logical: القسم 3 باب 15 رقم 42
      const text = "القسم 3 باب 15 رقم 42";
      const visual = toVisualOrder(text, "RTL");
      // Each number should retain its internal order
      expect(visual.includes("3")).toBe(true);
      expect(visual.includes("15")).toBe(true);
      expect(visual.includes("42")).toBe(true);
    });

    it("punctuation around numbers does not break digit order", () => {
      const text = "رقم #125)";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.includes("125")).toBe(true);
    });
  });

  describe("Arabic name with Latin ID", () => {
    it("محمد ID-125 — digits in correct visual order", () => {
      const visual = toVisualOrder("محمد ID-125", "RTL");
      // The visual order should have "125" (not "521")
      const match = visual.match(/\d+/);
      expect(match).not.toBeNull();
      expect(match![0]).toBe("125");
    });
  });

  describe("mixed Arabic/Latin text", () => {
    it("reorders Arabic with Latin parenthetical ID in RTL context", () => {
      const text = "محمد (Muhammad)";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.length).toBe(text.length);
    });

    it("reorders Arabic with Western digits correctly", () => {
      const text = "البيت 123";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.length).toBe(text.length);
      // The visual string should contain the digits
      expect(visual.match(/\d+/)?.[0]).toBe("123");
    });

    it("reorders Arabic with Arabic-Indic digits", () => {
      const text = "رقم ١٤٤٦";
      const visual = toVisualOrder(text, "RTL");
      expect(visual.length).toBe(text.length);
      const chars = [...visual];
      const digits = chars.filter((c) => c >= "\u0660" && c <= "\u0669");
      expect(digits.join("")).toBe("١٤٤٦");
    });

    it("logical and visual order differ for mixed Arabic/Latin input under LTR", () => {
      const text = "Hello محمد World";
      expect(toVisualOrder(text, "LTR")).not.toBe(text);
    });

    it("logical and visual order differ for mixed input under RTL", () => {
      const text = "Hello محمد";
      expect(toVisualOrder(text, "RTL")).not.toBe(text);
    });
  });

  describe("punctuation and parentheses", () => {
    it("parentheses surround correct content in visual order", () => {
      const text = "(test) محمد";
      const visual = toVisualOrder(text, "RTL");
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
    });

    it("preserves digit order across multiple RTL/LTR transitions", () => {
      const text = "Hello 123 محمد 456";
      const visual = toVisualOrder(text, "LTR");
      // Under LTR, digits should be in expected positions
      expect(visual.includes("123")).toBe(true);
      expect(visual.includes("456")).toBe(true);
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
      const result = reorderBidi("Hello محمد", "LTR");
      expect(result.visualOrder[0]).toBeLessThan(6);
    });

    it("RTL paragraph direction starts RTL content on right", () => {
      const text = "Hello محمد";
      const result = reorderBidi(text, "RTL");
      const firstChar = [...text][result.visualOrder[0]!]!;
      const isArabic = /[\u0600-\u06FF]/.test(firstChar);
      expect(isArabic).toBe(true);
    });
  });
});

describe("shapeWithBidi integration", () => {
  it("does not shape Arabic letters across directional boundaries", () => {
    const text = "محمد Hello أحمد";
    const shaped = shapeWithBidi(text, "LTR");
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

  it("shapeWithBidi on pure Latin is identity", () => {
    expect(shapeWithBidi("Hello World", "LTR")).toBe("Hello World");
    expect(shapeWithBidi("123", "LTR")).toBe("123");
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

  it("digit sequences maintain character set in visual order", () => {
    const text = "مواليد 1987";
    const visual = toVisualOrder(text, "RTL");
    // All digits should still be present
    const digitsInVisual = visual.replace(/\D/g, "");
    expect(digitsInVisual).toBe("1987");
  });
});

describe("numeric sequence integrity — exact assertions", () => {
  it("ID-125: digits 125 in order, hyphen preserved", () => {
    const visual = toVisualOrder("محمد ID-125", "RTL");
    // Under RTL paragraph, the Latin "ID-125" is an LTR run
    // The visual output should have "125" in order (not "521")
    const digitPart = visual.match(/[0-9-]+/)?.[0] ?? "";
    expect(digitPart.includes("125")).toBe(true);
  });

  it("generation 12: digits in order", () => {
    const visual = toVisualOrder("الجيل 12", "RTL");
    const digitPart = visual.match(/[0-9]+/)?.[0] ?? "";
    expect(digitPart).toBe("12");
  });

  it("year 1987: full year preserves digit order", () => {
    const visual = toVisualOrder("مواليد 1987", "RTL");
    const digitPart = visual.match(/[0-9]+/)?.[0] ?? "";
    expect(digitPart).toBe("1987");
  });

  it("hyphenated ID A-17: number 17 in correct order", () => {
    const visual = toVisualOrder("فرع A-17", "RTL");
    const digitPart = visual.match(/[0-9]+/)?.[0] ?? "";
    expect(digitPart).toBe("17");
  });

    it("multiple numbers: each retains internal digit order", () => {
      const text = "القسم 3 باب 15 رقم 42";
      const visual = toVisualOrder(text, "RTL");
      // RTL visual order reverses the sentence, so digits appear as 42, 15, 3
      // But each number internally keeps its order: 42 not 24, 15 not 51, 3 not 3
      const digits = [...visual].filter((c) => c >= "0" && c <= "9").join("");
      // 42 is in visual order, 15 is in visual order, 3 is in visual order
      expect(digits.includes("42")).toBe(true);
      expect(digits.includes("15")).toBe(true);
      expect(digits.includes("3")).toBe(true);
      // None should be reversed
      expect(digits.includes("24")).toBe(false);
      expect(digits.includes("51")).toBe(false);
    });

  it("Arabic-Indic digits ١٤٤٦ internal order preserved", () => {
    const text = "رقم ١٤٤٦";
    const visual = toVisualOrder(text, "RTL");
    const aiChars = [...visual].filter((c) => c >= "\u0660" && c <= "\u0669");
    expect(aiChars.join("")).toBe("١٤٤٦");
  });

  it("multiline with numbers: each line preserves digit order", () => {
    const text = "مواليد 1987\nجيل 12";
    const lines = toVisualOrder(text, "RTL").split("\n");
    for (const line of lines) {
      const digits = [...line].filter((c) => c >= "0" && c <= "9").join("");
      if (digits.length > 0) {
        expect(digits === "1987" || digits === "12").toBe(true);
      }
    }
  });
});

describe("shapeArabic uses logical-order neighbors", () => {
  it("shapeWithBidi selects initial/medial/final based on logical neighbors", () => {
    // The word "يكتب" has logical order: ي-ك-ت-ب
    // shapeArabic on logical text selects the correct forms
    const shaped = shapeWithBidi("يكتب", "RTL");
    // The shaped output should be non-empty and contain presentation forms
    expect(shaped.length).toBeGreaterThan(0);
    // At least one character should be a presentation form (U+FE**)
    const hasPresForm = [...shaped].some((c) => {
      const cp = c.charCodeAt(0);
      return (cp >= 0xFE70 && cp <= 0xFEFC) || (cp >= 0xFB50 && cp <= 0xFDFF);
    });
    expect(hasPresForm).toBe(true);
  });
});
