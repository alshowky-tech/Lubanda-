/**
 * Deterministic Unicode Bidirectional Algorithm (UAX #9) implementation
 * for mixed RTL/LTR text reordering.
 *
 * This pure-JS implementation performs the core steps of the Unicode
 * Bidirectional Algorithm to convert logical-order text to visual-order
 * glyph runs suitable for measurement and rendering.
 *
 * Algorithm overview:
 * 1. Classify each character by its Unicode Bidi_Class
 * 2. Resolve weak types overrides
 * 3. Resolve neutral types by context
 * 4. Resolve implicit levels
 * 5. Reorder levels to visual order
 *
 * This implementation is fully deterministic: same input and base direction
 * always produce the same visual-order output.
 *
 * Limitation: Does NOT implement explicit formatting characters
 * (LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI) — only implicit
 * directional runs. This is sufficient for the Lubanda label domain
 * where text is plain Arabic/Latin names with punctuation.
 */

// -- Bidirectional character types per UAX #9 --
export type BidiType =
  | "L"   // Left-to-Right
  | "R"   // Right-to-Left
  | "EN"  // European Number
  | "ES"  // European Number Separator
  | "ET"  // European Number Terminator
  | "AN"  // Arabic Number
  | "CS"  // Common Number Separator
  | "NSM" // Nonspacing Mark
  | "BN"  // Boundary Neutral
  | "B"   // Paragraph Separator
  | "S"   // Segment Separator
  | "WS"  // Whitespace
  | "ON"; // Other Neutral

// -- Bidi class lookup --
const BIDI_CLASSES = new Map<number, BidiType>();

// Strong LTR: Latin, Greek, Cyrillic, etc.
for (let cp = 0x0041; cp <= 0x005A; cp += 1) BIDI_CLASSES.set(cp, "L"); // A-Z
for (let cp = 0x0061; cp <= 0x007A; cp += 1) BIDI_CLASSES.set(cp, "L"); // a-z
for (let cp = 0x00C0; cp <= 0x02AF; cp += 1) BIDI_CLASSES.set(cp, "L");
for (let cp = 0x0370; cp <= 0x03FF; cp += 1) BIDI_CLASSES.set(cp, "L"); // Greek
for (let cp = 0x0400; cp <= 0x04FF; cp += 1) BIDI_CLASSES.set(cp, "L"); // Cyrillic
for (let cp = 0x1E00; cp <= 0x1FFF; cp += 1) BIDI_CLASSES.set(cp, "L");
for (let cp = 0xFB00; cp <= 0xFB06; cp += 1) BIDI_CLASSES.set(cp, "L"); // Latin ligatures

// Strong RTL: Arabic, Hebrew, Syriac, Thaana, N'Ko
for (let cp = 0x0590; cp <= 0x05FF; cp += 1) BIDI_CLASSES.set(cp, "R"); // Hebrew
for (let cp = 0x0600; cp <= 0x06FF; cp += 1) BIDI_CLASSES.set(cp, "R"); // Arabic
for (let cp = 0x0700; cp <= 0x074F; cp += 1) BIDI_CLASSES.set(cp, "R"); // Syriac
for (let cp = 0x0750; cp <= 0x077F; cp += 1) BIDI_CLASSES.set(cp, "R"); // Arabic Supplement
for (let cp = 0x0780; cp <= 0x07BF; cp += 1) BIDI_CLASSES.set(cp, "R"); // Thaana
for (let cp = 0x07C0; cp <= 0x07FF; cp += 1) BIDI_CLASSES.set(cp, "R"); // N'Ko
for (let cp = 0x08A0; cp <= 0x08FF; cp += 1) BIDI_CLASSES.set(cp, "R"); // Arabic Extended-A/B
for (let cp = 0xFB50; cp <= 0xFDFF; cp += 1) BIDI_CLASSES.set(cp, "R"); // Arabic Pres Forms A
for (let cp = 0xFE70; cp <= 0xFEFC; cp += 1) BIDI_CLASSES.set(cp, "R"); // Arabic Pres Forms B

// AN: Arabic-Indic digits
for (let cp = 0x0660; cp <= 0x0669; cp += 1) BIDI_CLASSES.set(cp, "AN");

// EN: European digits
for (let cp = 0x0030; cp <= 0x0039; cp += 1) BIDI_CLASSES.set(cp, "EN");

// ES: European number separators
BIDI_CLASSES.set(0x002B, "ES"); // +
BIDI_CLASSES.set(0x002D, "ES"); // -

// ET: European number terminators
BIDI_CLASSES.set(0x0023, "ET"); // #
BIDI_CLASSES.set(0x0025, "ET"); // %
BIDI_CLASSES.set(0x00B0, "ET"); // °
for (let cp = 0x0024; cp <= 0x0024; cp += 1) BIDI_CLASSES.set(cp, "ET"); // $

// CS: Common separators
BIDI_CLASSES.set(0x002C, "CS"); // ,
BIDI_CLASSES.set(0x002E, "CS"); // .
BIDI_CLASSES.set(0x002F, "CS"); // /
BIDI_CLASSES.set(0x003A, "CS"); // :
BIDI_CLASSES.set(0x003B, "CS"); // (not in spec but common)

// NSM: Combining marks (transparent for bidi)
for (let cp = 0x0300; cp <= 0x036F; cp += 1) BIDI_CLASSES.set(cp, "NSM");
for (let cp = 0x064B; cp <= 0x065F; cp += 1) BIDI_CLASSES.set(cp, "NSM");
for (let cp = 0x0670; cp <= 0x0670; cp += 1) BIDI_CLASSES.set(cp, "NSM");
for (let cp = 0x06D6; cp <= 0x06DC; cp += 1) BIDI_CLASSES.set(cp, "NSM");
for (let cp = 0x06DF; cp <= 0x06E4; cp += 1) BIDI_CLASSES.set(cp, "NSM");
for (let cp = 0x06E7; cp <= 0x06E8; cp += 1) BIDI_CLASSES.set(cp, "NSM");
for (let cp = 0x06EA; cp <= 0x06ED; cp += 1) BIDI_CLASSES.set(cp, "NSM");

// WS: Whitespace
for (const cp of [0x0009, 0x000B, 0x000C, 0x0020, 0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000]) {
  BIDI_CLASSES.set(cp, "WS");
}

// S: Segment separators
BIDI_CLASSES.set(0x000D, "B"); // CR -> B
BIDI_CLASSES.set(0x000A, "B"); // LF -> B
BIDI_CLASSES.set(0x0009, "S"); // TAB
BIDI_CLASSES.set(0x0085, "B");
BIDI_CLASSES.set(0x2028, "B");
BIDI_CLASSES.set(0x2029, "B");

// ON: Other neutrals — most punctuation
for (const cp of [0x0021, 0x0022, 0x0026, 0x0027, 0x0028, 0x0029, 0x002A, 0x003C, 0x003D, 0x003E, 0x003F, 0x0040, 0x005B, 0x005C, 0x005D, 0x005E, 0x005F, 0x0060, 0x007B, 0x007C, 0x007D, 0x007E, 0x00A1, 0x00A7, 0x00AB, 0x00B6, 0x00B7, 0x00BB, 0x00BF, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2016, 0x2017, 0x2018, 0x2019, 0x201A, 0x201B, 0x201C, 0x201D, 0x201E, 0x201F, 0x2020, 0x2021, 0x2022, 0x2026]) {
  BIDI_CLASSES.set(cp, "ON");
}

// Parentheses
BIDI_CLASSES.set(0x0028, "ON"); // (
BIDI_CLASSES.set(0x0029, "ON"); // )

/**
 * Get the bidi class for a code point.
 * Defaults to ON for unknown characters.
 */
const getBidiType = (cp: number): BidiType => {
  return BIDI_CLASSES.get(cp) ?? "ON";
};

/**
 * Resolve the paragraph embedding level (0 for LTR, 1 for RTL).
 */
const paragraphLevel = (direction: string): number => direction === "RTL" ? 1 : 0;

/**
 * A single character with bidi information.
 */
export interface BidiChar {
  readonly codePoint: number;
  readonly originalIndex: number;
  readonly bidiType: BidiType;
  readonly level: number;
}

/**
 * Bidi-reordered run of characters.
 */
export interface BidiRun {
  readonly chars: readonly BidiChar[];
  readonly level: number;
  readonly direction: "L" | "R";
}

/**
 * Result of bidi processing.
 */
export interface BidiResult {
  readonly runs: readonly BidiRun[];
  readonly visualOrder: readonly number[]; // indices into original chars
}

/**
 * Perform deterministic Unicode bidirectional reordering (UAX #9)
 * on a text string with a given base paragraph direction.
 *
 * Steps performed:
 * 1. Classify each character by Bidi_Class
 * 2. Resolve weak types (W1–W7)
 * 3. Resolve neutral types (N1–N2)
 * 4. Resolve implicit levels (I1–I2)
 * 5. Reorder levels to visual order (L1–L4)
 *
 * @param text - input text (logical order)
 * @param direction - base paragraph direction ("LTR" | "RTL")
 * @returns bidi-reordered result with visual order indices
 */
export const reorderBidi = (text: string, direction: string): BidiResult => {
  const chars = [...text];
  const baseLevel = paragraphLevel(direction);
  const n = chars.length;

  // Step 1: Classify each character
  const bidiChars: BidiChar[] = chars.map((ch, i) => {
    const codePoint = ch.charCodeAt(0);
    return {
      codePoint,
      originalIndex: i,
      bidiType: getBidiType(codePoint),
      level: baseLevel,
    };
  });

  // Step 2: Apply explicit embedding (simplified — no explicit formatting codes)
  // For our domain (plain text without control codes), we skip the
  // explicit embedding/explicit override steps. The default paragraph
  // direction determines the base level.

  // Step 3: Resolve weak types
  // W1: NSM follow the bidi type of the preceding character
  for (let i = 1; i < n; i += 1) {
    const prev = bidiChars[i - 1]!;
    const curr = bidiChars[i]!;
    if (curr.bidiType === "NSM" && prev.bidiType !== "BN") {
      bidiChars[i] = { ...curr, bidiType: prev.bidiType };
    }
  }

  // W2: EN in RTL context become AN
  for (let i = 0; i < n; i += 1) {
    if (bidiChars[i]!.bidiType === "EN") {
      // Look backwards for a strong type
      let foundStrong: BidiType | undefined;
      for (let j = i - 1; j >= 0; j -= 1) {
        const t = bidiChars[j]!.bidiType;
        if (t === "R" || t === "L") { foundStrong = t; break; }
      }
      if (foundStrong === "R") {
        bidiChars[i] = { ...bidiChars[i]!, bidiType: "AN" };
      }
    }
  }

  // W3: Change AL to R (not needed — we classify Arabic as R directly)

  // W4: Single separators between numbers take the number type
  for (let i = 1; i < n - 1; i += 1) {
    const prev = bidiChars[i - 1]!;
    const curr = bidiChars[i]!;
    const next = bidiChars[i + 1]!;

    if (curr.bidiType === "ES" || curr.bidiType === "CS") {
      const prevIsNum = prev.bidiType === "EN" || prev.bidiType === "AN";
      const nextIsNum = next.bidiType === "EN" || next.bidiType === "AN";

      if (prevIsNum && nextIsNum) {
        // Both numbers same type?
        if (prev.bidiType === next.bidiType) {
          bidiChars[i] = { ...curr, bidiType: prev.bidiType };
        }
        // For CS between EN and AN, default to EN
        // (simplification: use the direction of the base level)
        else if (curr.bidiType === "CS") {
          bidiChars[i] = { ...curr, bidiType: baseLevel === 0 ? "EN" : "AN" };
        }
      }
    }
  }

  // W5: ET followed by EN becomes ET
  for (let i = 0; i < n - 1; i += 1) {
    if (bidiChars[i]!.bidiType === "ET") {
      let j = i;
      while (j < n && bidiChars[j]!.bidiType === "ET") j += 1;
      if (j < n && bidiChars[j]!.bidiType === "EN") {
        for (let k = i; k < j; k += 1) {
          bidiChars[k] = { ...bidiChars[k]!, bidiType: "EN" };
        }
      }
    }
  }

  // W6: Separators and terminators become ON
  for (let i = 0; i < n; i += 1) {
    const t = bidiChars[i]!.bidiType;
    if (t === "ES" || t === "ET" || t === "CS") {
      bidiChars[i] = { ...bidiChars[i]!, bidiType: "ON" };
    }
  }

  // W7: EN in RTL context become L
  // (W2 already handles EN->AN conversion in RTL contexts;
  //  remaining EN act as L for level resolution.)

  // Step 4: Resolve neutral types (N1–N2)
  for (let i = 0; i < n; i += 1) {
    const t = bidiChars[i]!.bidiType;
    if (t === "ON" || t === "WS" || t === "S") {
      // Find surrounding strong types
      let leftStrong: BidiType | undefined;
      let rightStrong: BidiType | undefined;

      for (let j = i - 1; j >= 0; j -= 1) {
        const tj = bidiChars[j]!.bidiType;
        if (tj === "L" || tj === "R") { leftStrong = tj; break; }
      }
      for (let j = i + 1; j < n; j += 1) {
        const tj = bidiChars[j]!.bidiType;
        if (tj === "L" || tj === "R") { rightStrong = tj; break; }
      }

      // N1: Same strong on both sides
      if (leftStrong !== undefined && leftStrong === rightStrong) {
        bidiChars[i] = { ...bidiChars[i]!, bidiType: leftStrong };
      }
      // N2: Opposite or missing — use base direction
      else {
        bidiChars[i] = { ...bidiChars[i]!, bidiType: baseLevel === 0 ? "L" : "R" };
      }
    }
  }

  // Step 5: Resolve implicit levels (I1–I2)
  // I1: L chars get level = 0 or 2; R chars get level = 1 or 3
  // We use even levels for LTR, odd for RTL
  const resolvedLevels = bidiChars.map((bc) => {
    if (bc.bidiType === "L" || bc.bidiType === "EN") {
      return { ...bc, level: 0 };
    }
    if (bc.bidiType === "R" || bc.bidiType === "AN") {
      return { ...bc, level: 1 };
    }
    return bc;
  });

  // Step 6: Reorder levels (L1–L4) — simplified to basic reorder
  // Group consecutive characters with the same level into runs
  const runs: { start: number; end: number; level: number }[] = [];
  let runStart = 0;
  for (let i = 1; i <= n; i += 1) {
    if (i === n || resolvedLevels[i]!.level !== resolvedLevels[runStart]!.level) {
      runs.push({ start: runStart, end: i, level: resolvedLevels[runStart]!.level });
      runStart = i;
    }
  }

  // If base level is 1 (RTL), reverse the order of runs
  // Each run's content is in logical order; RTL runs should be rendered LTR
  // For visual order, we reverse RTL runs' internal order and reverse run order
  const visualIndices: number[] = [];
  const resolvedRuns = runs.map((r) => {
    const runChars = resolvedLevels.slice(r.start, r.end);
    // For RTL-level runs, characters within the run are reversed
    if (r.level % 2 === 1) {
      runChars.reverse();
    }
    return runChars.map((bc) => bc.originalIndex);
  });

  // If base level is 1 (RTL), reverse run order too
  const orderedRuns = baseLevel === 1 ? [...resolvedRuns].reverse() : resolvedRuns;
  for (const run of orderedRuns) {
    visualIndices.push(...run);
  }

  // Build runs for the public API
  const publicRuns: BidiRun[] = [];
  for (const r of runs) {
    publicRuns.push({
      chars: Object.freeze(resolvedLevels.slice(r.start, r.end)),
      level: r.level,
      direction: r.level % 2 === 0 ? "L" : "R",
    });
  }

  return {
    runs: Object.freeze(publicRuns),
    visualOrder: Object.freeze(visualIndices),
  };
};

/**
 * Convert text from logical order to visual order using bidi reordering.
 * Characters within RTL runs are also reversed (per UAX #9 L2).
 *
 * @param text - input text in logical order
 * @param direction - base paragraph direction ("LTR" | "RTL")
 * @returns text in visual order for measurement/rendering
 */
export const toVisualOrder = (text: string, direction: string): string => {
  const result = reorderBidi(text, direction);
  const chars = [...text];
  const visualChars = result.visualOrder.map((i) => chars[i]!);
  return visualChars.join("");
};

/**
 * Reorder indices from logical to visual order.
 * Returns an array where position i contains the visual index for logical index i.
 */
export const logicalToVisual = (text: string, direction: string): readonly number[] => {
  const result = reorderBidi(text, direction);
  const n = text.length;
  const mapping = new Array<number>(n);
  for (let vi = 0; vi < result.visualOrder.length; vi += 1) {
    mapping[result.visualOrder[vi]!] = vi;
  }
  return Object.freeze(mapping);
};
