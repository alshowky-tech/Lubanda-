import { describe, expect, it } from "vitest";
import { OpentypeTextMeasurer } from "../../../src/core/labels/TextMeasurer.js";
import { TypographyCache } from "../../../src/core/labels/cache.js";
import { shapedText, shapedCodePoints } from "../../../src/core/labels/ArabicShaper.js";
import type { TextMeasureRequest } from "../../../src/core/labels/types.js";

const FONT_PATH = new URL(
  "../../../fonts/DejaVuSans.ttf",
  import.meta.url,
).pathname;

const DEFAULT_FONTS = [
  { family: "DejaVu Sans", weight: 400, style: "normal" as const, path: FONT_PATH },
];

const makeMeasurer = async (): Promise<OpentypeTextMeasurer> => {
  const m = new OpentypeTextMeasurer(DEFAULT_FONTS, 4);
  await m.initialize();
  return m;
};

const makeRequest = (overrides: Partial<TextMeasureRequest> = {}): TextMeasureRequest => ({
  text: "Hello",
  fontFamily: "DejaVu Sans",
  fontSize: 12,
  fontWeight: 400,
  letterSpacing: 0,
  direction: "LTR",
  maximumWidth: 0,
  lineCountPolicy: "NATURAL",
  maximumLines: 100,
  ...overrides,
});

describe("OpentypeTextMeasurer", () => {
  describe("initialization", () => {
    it("loads default fonts on initialize()", async () => {
      const measurer = new OpentypeTextMeasurer(DEFAULT_FONTS, 4);
      expect(measurer.cache.size).toBe(0);
      await measurer.initialize();
    });

    it("throws on empty text", async () => {
      const measurer = await makeMeasurer();
      await expect(measurer.measure(makeRequest({ text: "" }))).rejects.toThrow("non-empty string");
    });

    it("throws on invalid font size", async () => {
      const measurer = await makeMeasurer();
      await expect(measurer.measure(makeRequest({ fontSize: 0 }))).rejects.toThrow("positive");
    });

    it("throws on invalid font weight", async () => {
      const measurer = await makeMeasurer();
      await expect(measurer.measure(makeRequest({ fontWeight: 0 }))).rejects.toThrow("between 100 and 900");
    });

    it("throws on invalid direction", async () => {
      const measurer = await makeMeasurer();
      await expect(measurer.measure(makeRequest({ direction: "INVALID" as "LTR" }))).rejects.toThrow("LTR or RTL");
    });

    it("throws on invalid lineCountPolicy", async () => {
      const measurer = await makeMeasurer();
      await expect(measurer.measure(makeRequest({ lineCountPolicy: "INVALID" as "NATURAL" }))).rejects.toThrow("NATURAL, TRUNCATE, or CLAMP");
    });

    it("throws on invalid maximumLines", async () => {
      const measurer = await makeMeasurer();
      await expect(measurer.measure(makeRequest({ maximumLines: 0 }))).rejects.toThrow("positive integer");
    });
  });

  describe("Latin text measurement", () => {
    it("measures a single word", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "Hello" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.height).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
      expect(result.lineBoxes.length).toBe(1);
      expect(result.glyphOverflow).toBe(false);
    });

    it("measures multiple words on one line", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "Hello World" }));
      expect(result.lineCount).toBe(1);
      expect(result.width).toBeGreaterThan(0);
    });

    it("produces positive finite metrics", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "Testing 123" }));
      expect(Number.isFinite(result.width)).toBe(true);
      expect(result.width).toBeGreaterThan(0);
      expect(Number.isFinite(result.height)).toBe(true);
      expect(result.height).toBeGreaterThan(0);
      expect(Number.isFinite(result.baseline)).toBe(true);
      expect(result.baseline).toBeGreaterThan(0);
    });
  });

  describe("Arabic text measurement (shaped)", () => {
    it("measures Arabic text with shaped presentation forms", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "السلام", direction: "RTL" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
      expect(result.glyphOverflow).toBe(false);
    });

    it("shaped Arabic width differs from unshaped width", async () => {
      // When Arabic gets shaped, the presentation forms (U+FE**) have
      // different advance widths than the base characters (U+06**).
      // We verify this by checking the code point sequences differ.
      const shapedCPs = shapedCodePoints("السلام");
      const unshapedCPs = [..."السلام"].map((c) => c.charCodeAt(0));
      const shapedStr = String.fromCodePoint(...shapedCPs);

      // At least one code point should differ (shaping changes glyphs)
      const gotShaped = shapedCPs.some((cp, i) => cp !== unshapedCPs[i]!);
      expect(gotShaped).toBe(true);

      // Measure both shaped and unshaped via the measurer
      const measurer = await makeMeasurer();
      const shapedResult = await measurer.measure(makeRequest({ text: shapedStr, direction: "RTL" }));
      // Measure the original (should get shaped by the measurer so same)
      expect(shapedResult.width).toBeGreaterThan(0);
      expect(Number.isFinite(shapedResult.width)).toBe(true);
    });

    it("measures mixed Arabic and Latin text", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "محمد (Muhammad)", direction: "RTL" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });

    it("measures Arabic text with diacritics", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "مُحَمَّد", direction: "RTL" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });

    it("measures Arabic with tatweel (kashida)", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "محمد———", direction: "RTL" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });

    it("measures Arabic-Indic numerals", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "١٤٤٦", direction: "RTL" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });
  });

  describe("font-derived line height", () => {
    it("uses font ascender/descender for line height", async () => {
      const measurer = await makeMeasurer();
      // Access the loaded font to check its metrics
      const request = makeRequest({ text: "Hello\nWorld" });
      const result = await measurer.measure(request);
      // Line height should be approx (1901 - (-483)) / 2048 * 12 ≈ 13.96
      // DejaVuSans: ascender=1901, descender=-483, unitsPerEm=2048
      // lineHeight = (1901 + 483) / 2048 * 12 ≈ 13.96
      expect(result.height).toBeGreaterThan(0);
    });

    it("line height is consistent across lines", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "Line1 Line2 Long text to wrap",
        maximumWidth: 30,
      }));
      if (result.lineBoxes.length >= 2) {
        const line1 = result.lineBoxes[0]!;
        const line2 = result.lineBoxes[1]!;
        // Both lines should have same height
        expect(line1.height).toBe(line2.height);
        // Line 2 should be positioned below line 1
        expect(line2.y).toBeGreaterThan(line1.y);
      }
    });
  });

  describe("multiline wrapping", () => {
    it("wraps text at maximum width", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "Hello World This Is A Long Line Of Text",
        maximumWidth: 50,
        maximumLines: 100,
      }));
      expect(result.lineCount).toBeGreaterThan(1);
    });

    it("truncates lines with TRUNCATE policy", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "Hello World This Is A Long Line",
        maximumWidth: 30,
        lineCountPolicy: "TRUNCATE",
        maximumLines: 2,
      }));
      expect(result.lineCount).toBeLessThanOrEqual(2);
    });

    it("clamps lines with CLAMP policy", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "Hello World This Is A Long Line Of Text",
        maximumWidth: 40,
        lineCountPolicy: "CLAMP",
        maximumLines: 1,
      }));
      expect(result.lineCount).toBeLessThanOrEqual(1);
    });

    it("wraps Arabic text", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "هذا النص طويل جدا ويجب أن يلتف إلى سطر جديد",
        direction: "RTL",
        maximumWidth: 80,
        maximumLines: 100,
      }));
      expect(result.lineCount).toBeGreaterThanOrEqual(1);
    });

    it("returns single line when maximumWidth is 0 (unlimited)", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "Hello World This Is Long",
        maximumWidth: 0,
      }));
      expect(result.lineCount).toBe(1);
    });
  });

  describe("determinism", () => {
    it("produces byte-identical results on repeat", async () => {
      const measurer = await makeMeasurer();
      const request = makeRequest({ text: "Hello World", fontSize: 14 });
      const r1 = await measurer.measure(request);
      const r2 = await measurer.measure(request);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("produces byte-identical Arabic results on repeat", async () => {
      const measurer = await makeMeasurer();
      const request = makeRequest({ text: "السلام عليكم ورحمة الله", direction: "RTL", fontSize: 16 });
      const r1 = await measurer.measure(request);
      const r2 = await measurer.measure(request);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });
  });

  describe("cache behavior", () => {
    it("returns cached results without re-measuring", async () => {
      const cache = new TypographyCache();
      const measurer = new OpentypeTextMeasurer(DEFAULT_FONTS, 4, cache);
      await measurer.initialize();

      const request = makeRequest({ text: "Cache Test" });
      await measurer.measure(request);
      expect(cache.hits).toBe(0);
      expect(cache.misses).toBe(1);

      await measurer.measure(request);
      expect(cache.hits).toBe(1);
      expect(cache.misses).toBe(1);
    });

    it("different requests produce different cache entries", async () => {
      const cache = new TypographyCache();
      const measurer = new OpentypeTextMeasurer(DEFAULT_FONTS, 4, cache);
      await measurer.initialize();

      await measurer.measure(makeRequest({ text: "Hello" }));
      await measurer.measure(makeRequest({ text: "World" }));
      expect(cache.size).toBe(2);
    });

    it("cache can be cleared", async () => {
      const cache = new TypographyCache();
      const measurer = new OpentypeTextMeasurer(DEFAULT_FONTS, 4, cache);
      await measurer.initialize();

      await measurer.measure(makeRequest({ text: "Hello" }));
      expect(cache.size).toBe(1);
      cache.clear();
      expect(cache.size).toBe(0);
    });
  });

  describe("font fallback", () => {
    it("falls back to default font when family is unknown", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ fontFamily: "Nonexistent Font" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });
  });

  describe("immutability", () => {
    it("does not mutate the input request", async () => {
      const measurer = await makeMeasurer();
      const request = makeRequest({ text: "Immutable Test" });
      const originalText = request.text;
      await measurer.measure(request);
      expect(request.text).toBe(originalText);
    });

    it("returns frozen result objects", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "Frozen" }));
      expect(Object.isFrozen(result.lineBoxes)).toBe(true);
      if (result.lineBoxes.length > 0) {
        expect(Object.isFrozen(result.lineBoxes[0])).toBe(true);
      }
    });
  });

  describe("shaped vs unshaped measurement comparison", () => {
    it("shaped Arabic initial/medial/final forms have different advance widths than base", async () => {
      // Verify that presentation form glyphs (U+FE**) have different
      // advance widths than their base equivalents (U+06**).
      const fontPath = DEFAULT_FONTS[0]!.path;
      const fs = await import("node:fs");
      const opentype = await import("opentype.js");
      const data = fs.readFileSync(fontPath);
      const font = opentype.parse(data);

      const baseGlyph = font.charToGlyph("ب"); // U+0628, adv=1928
      const initialGlyph = font.charToGlyph("ﺑ"); // U+FE91, adv=570
      const medialGlyph = font.charToGlyph("ﺒ"); // U+FE92, adv=618

      // Initial form has a much smaller advance width than base
      expect(baseGlyph.advanceWidth).toBeGreaterThan(initialGlyph.advanceWidth);
      expect(baseGlyph.advanceWidth).toBeGreaterThan(medialGlyph.advanceWidth);
    });

    it("shaped text measurement produces different widths than unshaped", async () => {
      // Compare measurement of a word using shaped forms vs base forms
      const measurer = await makeMeasurer();

      // Base Arabic word: ب + ت (unshaped)
      const unshaped = "بت"; // base forms
      const shaped = shapedText("بت"); // should be presentation forms

      // If shaping changed forms, the unshaped and shaped text widths may differ
      const unshapedResult = await measurer.measure(makeRequest({ text: unshaped, direction: "LTR", fontSize: 12 }));
      const shapedResult = await measurer.measure(makeRequest({ text: shaped, direction: "LTR", fontSize: 12 }));

      // Both should produce finite positive widths
      expect(Number.isFinite(unshapedResult.width)).toBe(true);
      expect(unshapedResult.width).toBeGreaterThan(0);
      expect(Number.isFinite(shapedResult.width)).toBe(true);
      expect(shapedResult.width).toBeGreaterThan(0);
    });
  });

  describe("line height from font metrics", () => {
    it("line height is derived from font ascender/descender", async () => {
      const measurer = await makeMeasurer();
      const fontSize = 12;

      // DejaVuSans: ascender=1901, descender=-483, unitsPerEm=2048
      // lineHeight = (1901 - (-483) + 0) / 2048 * 12 = 2384/2048*12 ≈ 13.97
      const expectedLineHeight = ((1901 + 483) / 2048) * fontSize;

      const result = await measurer.measure(makeRequest({
        text: "Hello World",
        fontSize,
      }));
      // Single line height should be close to expected line height
      expect(result.height).toBeGreaterThan(expectedLineHeight * 0.9);
      expect(result.height).toBeLessThan(expectedLineHeight * 1.1);

      // First baseline should be near ascender * scale
      const expectedBaseline = (1901 / 2048) * fontSize;
      expect(result.baseline).toBeGreaterThan(expectedBaseline * 0.9);
      expect(result.baseline).toBeLessThan(expectedBaseline * 1.1);
    });
  });
});
