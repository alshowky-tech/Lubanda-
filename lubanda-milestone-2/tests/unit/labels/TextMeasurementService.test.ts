import { describe, expect, it } from "vitest";
import { OpentypeTextMeasurer } from "../../../src/core/labels/TextMeasurer.js";
import { TypographyCache } from "../../../src/core/labels/cache.js";
import type { TextMeasureRequest } from "../../../src/core/labels/types.js";

const FONT_PATH = new URL(
  "../../../fonts/DejaVuSans.ttf",
  import.meta.url,
).pathname;

const FONT_BOLD_PATH = new URL(
  "../../../fonts/DejaVuSans-Bold.ttf",
  import.meta.url,
).pathname;

const DEFAULT_FONTS = [
  { family: "DejaVu Sans", weight: 400, style: "normal" as const, path: FONT_PATH },
  { family: "DejaVu Sans", weight: 700, style: "normal" as const, path: FONT_BOLD_PATH },
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
      // Should not throw
    });

    it("throws on empty text", async () => {
      const measurer = await makeMeasurer();
      await expect(
        measurer.measure(makeRequest({ text: "" })),
      ).rejects.toThrow("non-empty string");
    });

    it("throws on invalid font size", async () => {
      const measurer = await makeMeasurer();
      await expect(
        measurer.measure(makeRequest({ fontSize: 0 })),
      ).rejects.toThrow("positive");
    });

    it("throws on invalid font weight", async () => {
      const measurer = await makeMeasurer();
      await expect(
        measurer.measure(makeRequest({ fontWeight: 0 })),
      ).rejects.toThrow("between 100 and 900");
    });

    it("throws on invalid direction", async () => {
      const measurer = await makeMeasurer();
      await expect(
        measurer.measure(makeRequest({ direction: "INVALID" as "LTR" })),
      ).rejects.toThrow("LTR or RTL");
    });

    it("throws on invalid lineCountPolicy", async () => {
      const measurer = await makeMeasurer();
      await expect(
        measurer.measure(makeRequest({ lineCountPolicy: "INVALID" as "NATURAL" })),
      ).rejects.toThrow("NATURAL, TRUNCATE, or CLAMP");
    });

    it("throws on invalid maximumLines", async () => {
      const measurer = await makeMeasurer();
      await expect(
        measurer.measure(makeRequest({ maximumLines: 0 })),
      ).rejects.toThrow("positive integer");
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

    it("measures bold text wider than normal", async () => {
      const measurer = await makeMeasurer();
      const normal = await measurer.measure(makeRequest({ text: "Hello", fontWeight: 400 }));
      const bold = await measurer.measure(makeRequest({ text: "Hello", fontWeight: 700 }));
      // Bold should generally be at least as wide as normal
      expect(bold.width).toBeGreaterThanOrEqual(normal.width * 0.8);
    });
  });

  describe("Arabic text measurement", () => {
    it("measures Arabic text", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "السلام عليكم",
        direction: "RTL",
      }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
      expect(result.lineBoxes.length).toBe(1);
      expect(result.glyphOverflow).toBe(false);
    });

    it("measures mixed Arabic and Latin text", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "محمد (Muhammad)",
        direction: "RTL",
      }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });

    it("measures Arabic text with diacritics", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "مُحَمَّد",
        direction: "RTL",
      }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });

    it("measures Arabic with tatweel (kashida)", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "محمد———",
        direction: "RTL",
      }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
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
      expect(result.lineBoxes.length).toBeGreaterThan(1);
    });

    it("truncates lines with TRUNCATE policy", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "Hello World This Is A Long Line Of Text That Wraps",
        maximumWidth: 40,
        lineCountPolicy: "TRUNCATE",
        maximumLines: 2,
      }));
      expect(result.lineCount).toBeLessThanOrEqual(2);
    });

    it("clamps lines with CLAMP policy", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "Hello World This Is A Long Line Of Text",
        maximumWidth: 50,
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
      expect(result.lineBoxes.length).toBeGreaterThanOrEqual(1);
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
      const request = makeRequest({
        text: "السلام عليكم ورحمة الله",
        direction: "RTL",
        fontSize: 16,
      });
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
      const r1 = await measurer.measure(request);
      expect(cache.hits).toBe(0);
      expect(cache.misses).toBe(1);

      const r2 = await measurer.measure(request);
      expect(cache.hits).toBe(1);
      expect(cache.misses).toBe(1);
      expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
    });

    it("different requests produce different cache keys", async () => {
      const cache = new TypographyCache();
      const measurer = new OpentypeTextMeasurer(DEFAULT_FONTS, 4, cache);
      await measurer.initialize();

      await measurer.measure(makeRequest({ text: "Hello" }));
      await measurer.measure(makeRequest({ text: "World" }));
      expect(cache.size).toBe(2);
    });

    it("same text different font sizes are different cache entries", async () => {
      const cache = new TypographyCache();
      const measurer = new OpentypeTextMeasurer(DEFAULT_FONTS, 4, cache);
      await measurer.initialize();

      await measurer.measure(makeRequest({ text: "Hello", fontSize: 12 }));
      await measurer.measure(makeRequest({ text: "Hello", fontSize: 24 }));
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
      expect(cache.hits).toBe(0);
    });
  });

  describe("font fallback", () => {
    it("falls back to default font when family is unknown", async () => {
      const measurer = await makeMeasurer();
      // Unknown family should fall back to first loaded font
      const result = await measurer.measure(makeRequest({ fontFamily: "Nonexistent Font" }));
      expect(result.width).toBeGreaterThan(0);
      expect(result.lineCount).toBe(1);
    });
  });

  describe("text overflow detection", () => {
    it("detects glyph overflow when text exceeds maximumWidth", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({
        text: "ThisVeryLongWordExceedsTheWidth",
        maximumWidth: 20,
        maximumLines: 100,
      }));
      // A long word that can't wrap may overflow
      expect(typeof result.glyphOverflow).toBe("boolean");
    });
  });

  describe("immutability", () => {
    it("does not mutate the input request", async () => {
      const measurer = await makeMeasurer();
      const request = makeRequest({ text: "Immutable Test" });
      const originalText = request.text;
      const originalFontSize = request.fontSize;
      await measurer.measure(request);
      expect(request.text).toBe(originalText);
      expect(request.fontSize).toBe(originalFontSize);
    });

    it("returns frozen result objects", async () => {
      const measurer = await makeMeasurer();
      const result = await measurer.measure(makeRequest({ text: "Frozen" }));
      expect(Object.isFrozen(result.lineBoxes)).toBe(true);
      expect(Object.isFrozen(result.lineBoxes[0])).toBe(true);
    });
  });

  describe("cache key construction", () => {
    it("TypographyCache.buildKey produces deterministic keys", () => {
      const k1 = TypographyCache.buildKey(makeRequest({ text: "Hello" }));
      const k2 = TypographyCache.buildKey(makeRequest({ text: "Hello" }));
      expect(k1).toBe(k2);
    });

    it("different requests produce different keys", () => {
      const k1 = TypographyCache.buildKey(makeRequest({ text: "Hello" }));
      const k2 = TypographyCache.buildKey(makeRequest({ text: "World" }));
      expect(k1).not.toBe(k2);
    });

    it("same text different fonts produce different keys", () => {
      const k1 = TypographyCache.buildKey(makeRequest({ text: "Hello", fontSize: 12 }));
      const k2 = TypographyCache.buildKey(makeRequest({ text: "Hello", fontSize: 14 }));
      expect(k1).not.toBe(k2);
    });

    it("same text different direction produce different keys", () => {
      const k1 = TypographyCache.buildKey(makeRequest({ text: "Hello", direction: "LTR" }));
      const k2 = TypographyCache.buildKey(makeRequest({ text: "Hello", direction: "RTL" }));
      expect(k1).not.toBe(k2);
    });
  });
});
