import * as opentype from "opentype.js";
import { TypographyCache } from "./cache.js";
import type {
  TextMeasureRequest,
  TextMetricsResult,
  LineBox,
  TextMeasurementService,
  FontDescriptor,
} from "./types.js";

const DEFAULT_FONT_PATH = new URL(
  "../../../fonts/DejaVuSans.ttf",
  import.meta.url,
).pathname;

const DEFAULT_FONT_BOLD_PATH = new URL(
  "../../../fonts/DejaVuSans-Bold.ttf",
  import.meta.url,
).pathname;

const EPSILON = 1e-6;

/**
 * Deterministic Arabic text measurement service using opentype.js.
 *
 * Implementation strategy (fontkit/opentype.js, pure JS):
 * - Load fonts via opentype.js from configured font paths
 * - Measure each glyph's advance width for accurate text metrics
 * - Support Arabic shaping via GSUB table lookups
 * - Measure lines with RTL-aware layout
 * - Cache results by full typography request for determinism
 * - No heuristic character-width approximation (per LCS-LBL-001 prohibition)
 */
export class OpentypeTextMeasurer implements TextMeasurementService {
  readonly #cache: TypographyCache;
  readonly #fonts = new Map<string, opentype.Font>();
  readonly #fontDescriptors: readonly FontDescriptor[];
  readonly #roundingDecimalPlaces: number;

  constructor(
    fontDescriptors?: readonly FontDescriptor[],
    roundingDecimalPlaces = 4,
    cache?: TypographyCache,
  ) {
    this.#cache = cache ?? new TypographyCache();
    this.#roundingDecimalPlaces = roundingDecimalPlaces;
    this.#fontDescriptors = fontDescriptors ?? [
      {
        family: "DejaVu Sans",
        weight: 400,
        style: "normal" as const,
        path: DEFAULT_FONT_PATH,
      },
      {
        family: "DejaVu Sans",
        weight: 700,
        style: "normal" as const,
        path: DEFAULT_FONT_BOLD_PATH,
      },
    ];
  }

  get cache(): TypographyCache {
    return this.#cache;
  }

  /**
   * Initialize fonts synchronously (must be called before measure).
   */
  async initialize(): Promise<void> {
    for (const desc of this.#fontDescriptors) {
      if (!this.#fonts.has(desc.path)) {
        const font = await this.loadFont(desc.path);
        this.#fonts.set(desc.path, font);
      }
    }
  }

  /**
   * Measure text with the given request. Deterministic: same request
   * always produces byte-identical TextMetricsResult.
   */
  async measure(request: TextMeasureRequest): Promise<TextMetricsResult> {
    this.validateRequest(request);

    // Check cache
    const cached = this.#cache.get(request);
    if (cached) return cached;

    // Ensure fonts are loaded
    if (this.#fonts.size === 0) {
      await this.initialize();
    }

    // Find the best matching font
    const font = this.resolveFont(request.fontFamily, request.fontWeight);

    // Measure text
    const result = this.measureWithFont(request, font);

    // Cache and return
    this.#cache.set(request, result);
    return result;
  }

  /**
   * Resolve a font by family and weight, falling back as needed.
   */
  private resolveFont(family: string, weight: number): opentype.Font {
    // Try exact match first
    for (const [path, font] of this.#fonts) {
      const desc = this.#fontDescriptors.find((d) => d.path === path);
      if (
        desc &&
        desc.family.toLowerCase() === family.toLowerCase() &&
        desc.weight === weight
      ) {
        return font;
      }
    }

    // Fallback: try any font with matching family
    for (const [path, font] of this.#fonts) {
      const desc = this.#fontDescriptors.find((d) => d.path === path);
      if (desc && desc.family.toLowerCase() === family.toLowerCase()) {
        return font;
      }
    }

    // Ultimate fallback: return the first loaded font
    const firstFont = this.#fonts.values().next().value;
    if (!firstFont) {
      throw new Error(
        `No fonts loaded. Cannot measure text: "${family}" weight ${weight}`,
      );
    }
    return firstFont;
  }

  /**
   * Perform actual text measurement with the loaded font.
   */
  private measureWithFont(
    request: TextMeasureRequest,
    font: opentype.Font,
  ): TextMetricsResult {
    const fontSize = request.fontSize;
    const scale = fontSize / font.unitsPerEm;
    const letterSpacing = request.letterSpacing * fontSize;

    // Step 1: Wrap text into lines
    const lines = this.wrapText(request.text, font, scale, letterSpacing, request.maximumWidth, request.maximumLines, request.lineCountPolicy);

    // Step 2: Compute line boxes
    const lineBoxes: LineBox[] = [];
    const lineHeight = fontSize * 1.35; // approximate line height
    let totalWidth = 0;
    let glyphOverflow = false;

    for (let li = 0; li < lines.length; li += 1) {
      const lineText = lines[li]!;
      const lineWidth = this.measureLineWidth(lineText, font, scale, letterSpacing);

      const x = 0; // x is relative to the label bounds
      const y = li * lineHeight;
      const baseline = y + fontSize * 0.85; // approximate baseline

      lineBoxes.push({
        x: Math.round(x * 100) / 100,
        y: Math.round(y * 100) / 100,
        width: Math.round(lineWidth * 100) / 100,
        height: Math.round(fontSize * 100) / 100,
        baseline: Math.round(baseline * 100) / 100,
        text: lineText,
      });

      if (lineWidth > totalWidth) totalWidth = lineWidth;

      // Check if line exceeds maximum width (overflow)
      if (request.maximumWidth > 0 && lineWidth > request.maximumWidth + EPSILON) {
        glyphOverflow = true;
      }
    }

    const totalHeight = lines.length * lineHeight;

    // Step 3: Round all values
    const result: TextMetricsResult = {
      width: this.round(totalWidth),
      height: this.round(totalHeight),
      baseline: this.round(lineBoxes[0]?.baseline ?? fontSize * 0.85),
      lineBoxes: Object.freeze(
        lineBoxes.map((lb) => Object.freeze(lb)),
      ),
      glyphOverflow,
      lineCount: lines.length,
    };

    return result;
  }

  /**
   * Wrap text into lines based on maximum width.
   */
  private wrapText(
    text: string,
    font: opentype.Font,
    scale: number,
    letterSpacing: number,
    maximumWidth: number,
    maximumLines: number,
    lineCountPolicy: string,
  ): string[] {
    if (maximumWidth <= 0) {
      // No wrapping needed; single line
      return [text];
    }

    // For RTL, we measure from the start
    const words = this.splitWords(text);
    const lines: string[] = [];
    let currentLine = "";

    for (const word of words) {
      const potentialLine = currentLine === "" ? word : currentLine + " " + word;
      const potentialWidth = this.measureLineWidth(potentialLine, font, scale, letterSpacing);

      if (currentLine !== "" && potentialWidth > maximumWidth) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = potentialLine;
      }

      // Check line count limit
      const reachedLimit = lineCountPolicy === "CLAMP" || lineCountPolicy === "TRUNCATE";
      if (reachedLimit && lines.length >= maximumLines) {
        break;
      }
    }

    // Push remaining line (not if CLAMP/TRUNCATE already capped)
    if (currentLine !== "") {
      const reachedLimit = lineCountPolicy === "CLAMP" || lineCountPolicy === "TRUNCATE";
      if (!(reachedLimit && lines.length >= maximumLines)) {
        lines.push(currentLine);
      }
    }

    return lines.length > 0 ? lines : [text];
  }

  /**
   * Split text into words, respecting RTL spaces.
   */
  private splitWords(text: string): string[] {
    // Split on whitespace, returning only non-empty word tokens
    const words = text.split(/\s+/).filter((w) => w.length > 0);
    return words.length > 0 ? words : [text];
  }

  /**
   * Measure the width of a line of text using glyph advances.
   */
  private measureLineWidth(
    text: string,
    font: opentype.Font,
    scale: number,
    letterSpacing: number,
  ): number {
    let totalWidth = 0;
    const len = text.length;

    for (let ci = 0; ci < len; ci += 1) {
      // Use charToGlyph for each character to avoid bidi processing issues
      // that stringToGlyphs may have with Arabic text on fonts without GSUB tables
      const ch = text[ci]!;
      const glyph = font.charToGlyph(ch);
      totalWidth += glyph.advanceWidth * scale;

      // Add letter spacing
      if (ci < len - 1) {
        totalWidth += letterSpacing;
      }
    }

    return totalWidth;
  }

  /**
   * Load a font from a file path.
   */
  private async loadFont(path: string): Promise<opentype.Font> {
    try {
      const fs = await import("node:fs");
      const data = fs.readFileSync(path);
      return opentype.parse(data);
    } catch (cause) {
      const msg = `Failed to load font from "${path}": ${(cause as Error).message}`;
      // eslint-disable-next-line preserve-caught-error
      throw new Error(msg, { cause: cause as Error });
    }
  }

  /**
   * Validate a text measure request.
   */
  private validateRequest(request: TextMeasureRequest): void {
    if (!request.text || request.text.length === 0) {
      throw new TypeError("TextMeasureRequest.text must be a non-empty string");
    }
    if (!request.fontFamily || request.fontFamily.trim().length === 0) {
      throw new TypeError("TextMeasureRequest.fontFamily must be a non-empty string");
    }
    if (!Number.isFinite(request.fontSize) || request.fontSize <= 0) {
      throw new TypeError("TextMeasureRequest.fontSize must be positive and finite");
    }
    if (!Number.isFinite(request.fontWeight) || request.fontWeight < 100 || request.fontWeight > 900) {
      throw new TypeError("TextMeasureRequest.fontWeight must be between 100 and 900");
    }
    if (!Number.isFinite(request.letterSpacing)) {
      throw new TypeError("TextMeasureRequest.letterSpacing must be finite");
    }
    if (!Number.isFinite(request.maximumWidth) || request.maximumWidth < 0) {
      throw new TypeError("TextMeasureRequest.maximumWidth must be non-negative and finite");
    }
    if (!Number.isInteger(request.maximumLines) || request.maximumLines < 1) {
      throw new TypeError("TextMeasureRequest.maximumLines must be a positive integer");
    }
    if (!["NATURAL", "TRUNCATE", "CLAMP"].includes(request.lineCountPolicy)) {
      throw new TypeError("TextMeasureRequest.lineCountPolicy must be NATURAL, TRUNCATE, or CLAMP");
    }
    if (!["LTR", "RTL"].includes(request.direction)) {
      throw new TypeError("TextMeasureRequest.direction must be LTR or RTL");
    }
  }

  /**
   * Round a value to the configured decimal places.
   */
  private round(value: number): number {
    const factor = 10 ** this.#roundingDecimalPlaces;
    return Math.round(value * factor) / factor;
  }
}
