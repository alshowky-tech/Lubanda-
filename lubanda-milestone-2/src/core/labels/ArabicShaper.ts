/**
 * Basic deterministic contextual-form Arabic text shaping.
 *
 * This implementation maps base Arabic letters (U+0600-06FF) to their
 * Arabic Presentation Forms (U+FB50-FDFF, U+FE70-FEFC) based on Unicode
 * joining properties from the Unicode Character Database (UCD).
 *
 * The algorithm is based on joining types (Right-Joining, Dual-Joining,
 * Non-Joining, Transparent) derived from the UCD. It selects the correct
 * isolated, initial, medial, or final presentation form for each
 * Arabic letter based on its joining context within the text.
 *
 * This is NOT a complete OpenType shaping engine. It does NOT use GSUB
 * tables or support font-specific shaping features. It implements basic
 * deterministic contextual-form selection sufficient for accurate glyph
 * advance measurement with fonts that include Arabic presentation forms.
 *
 * Key features:
 * - Joining type classification per UCD
 * - Contextual form selection (isolated/initial/medial/final)
 * - Lam-alef ligature detection with 4 contextual forms
 * - Transparent combining mark passthrough (diacritics do not break joining)
 * - Non-Arabic character passthrough (Latin, digits, punctuation)
 * - Fully deterministic: same input always produces same output
 *
 * Combined with BidiProcessor for directional-run-aware shaping:
 * - Shapes Arabic within each directional run independently
 * - Never connects Arabic letters across bidi boundaries
 * - Produces visual-order shaped output for measurement
 *
 * References:
 * - Unicode Standard Annex #44: Unicode Character Database
 * - Unicode Standard Annex #9: Unicode Bidirectional Algorithm
 * - Arabic Presentation Forms B block (U+FE70-U+FEFC)
 */

import { reorderBidi } from "./BidiProcessor.js";

// -- Joining types --
const J = { R: "R", D: "D", U: "U", T: "T", L: "L" } as const;
type JoiningType = (typeof J)[keyof typeof J];

// -- Joining type lookup for Arabic characters --
const JOINING_TYPES = new Map<number, JoiningType>();

// Dual-joining Arabic letters (D): connect both sides
const DUAL_JOINING_RANGES: readonly [number, number][] = [
  [0x0622, 0x0622], // Alef with madda (actually R, overridden below)
  [0x0627, 0x0627], // Alef (R)
  [0x0628, 0x0628], // Beh
  [0x062A, 0x062E], // Teh, Theh, Jeem, Hah, Khah
  [0x0633, 0x063A], // Seen, Sheen, Sad, Dad, Tah, Zah, Ain, Ghain
  [0x0641, 0x0648], // Feh, Qaf, Kaf, Lam, Meem, Noon, Heh, Waw
  [0x064B, 0x064B], // Fathatan (T)
  [0x064E, 0x0652], // Fatha, Damma, Kasra, etc. (T)
  [0x0660, 0x0669], // Arabic-Indic digits (U)
  [0x066E, 0x066F], // (D)
  [0x0671, 0x06BF], // Extended Arabic (many D)
  [0x06C0, 0x06CE], // (mixed)
  [0x06D0, 0x06D2], // (D)
  [0x06D5, 0x06D5], // (D)
  [0x06FA, 0x06FC], // (D)
  [0x06FF, 0x06FF], // (D)
  [0x0750, 0x077F], // Arabic Supplement
  [0x08A0, 0x08B4], // Arabic Extended-A
  [0x08B6, 0x08BD], // Arabic Extended-A
  [0x08D4, 0x08E1], // Arabic Extended-A marks (T)
  [0x08E3, 0x08FF], // Arabic Extended-A marks (T)
];

// Initialize joining type map with defaults
for (const [start, end] of DUAL_JOINING_RANGES) {
  for (let cp = start; cp <= end; cp += 1) {
    // Default most to DUAL, override specific ones below
    JOINING_TYPES.set(cp, J.D);
  }
}

// Right-Joining letters (R): connect to previous only
const RIGHT_JOINING_CODEPOINTS: readonly number[] = [
  0x0622, // Alef with madda
  0x0623, // Alef with hamza above
  0x0624, // Waw with hamza above
  0x0625, // Alef with hamza below
  0x0626, // Yeh with hamza above (D in some contexts)
  0x0627, // Alef
  0x0629, // Teh marbuta
  0x062F, // Dal
  0x0630, // Thal
  0x0631, // Reh
  0x0632, // Zain
  0x0648, // Waw
  0x0649, // Alef maksura
  0x0670, // Superscript alef (T)
  0x0671, // Alef wasla
  0x0688, 0x0699, // Dal-like (R)
  0x06C0, // Heh yeh (R)
  0x06C1, 0x06C2, // Heh goal (D)
  0x06C3, 0x06CB, // (R and various)
  0x06CC, // Yeh (D)
  0x06CD, 0x06CF, // (R)
  0x06D2, // Yeh barree (D)
  0x06D3, // Yeh barree hamza (R)
  0x06EE, 0x06EF, // (R)
];

for (const cp of RIGHT_JOINING_CODEPOINTS) {
  JOINING_TYPES.set(cp, J.R);
}

// Non-Joining (U): punctuation, digits, etc.
for (let cp = 0x0600; cp <= 0x0605; cp += 1) JOINING_TYPES.set(cp, J.U);
for (let cp = 0x0660; cp <= 0x0669; cp += 1) JOINING_TYPES.set(cp, J.U);
for (let cp = 0x066A; cp <= 0x066D; cp += 1) JOINING_TYPES.set(cp, J.U);
for (let cp = 0x06F0; cp <= 0x06F9; cp += 1) JOINING_TYPES.set(cp, J.U);
for (let cp = 0x06FA; cp <= 0x06FC; cp += 1) JOINING_TYPES.set(cp, J.D);
JOINING_TYPES.set(0x06FD, J.U);
JOINING_TYPES.set(0x06FE, J.D);
JOINING_TYPES.set(0x06FF, J.D);

// Transparent (T): combining marks that don't affect joining
for (let cp = 0x064B; cp <= 0x065F; cp += 1) JOINING_TYPES.set(cp, J.T);
for (let cp = 0x0670; cp <= 0x0670; cp += 1) JOINING_TYPES.set(cp, J.T);
for (let cp = 0x06D6; cp <= 0x06DC; cp += 1) JOINING_TYPES.set(cp, J.T);
for (let cp = 0x06DF; cp <= 0x06E4; cp += 1) JOINING_TYPES.set(cp, J.T);
for (let cp = 0x06E7; cp <= 0x06E8; cp += 1) JOINING_TYPES.set(cp, J.T);
for (let cp = 0x06EA; cp <= 0x06ED; cp += 1) JOINING_TYPES.set(cp, J.T);
for (let cp = 0x08D4; cp <= 0x08E1; cp += 1) JOINING_TYPES.set(cp, J.T);
for (let cp = 0x08E3; cp <= 0x0902; cp += 1) JOINING_TYPES.set(cp, J.T);

// -- Presentation form mappings --
// Isolated, Final, Initial, Medial for each base Arabic letter.
// Base code point -> [isolated, final, initial, medial]
const FORM_MAP = new Map<number, readonly [number, number, number, number]>();

// Major Arabic letters and their presentation forms
const FORM_ENTRIES: readonly [number, number, number, number, number][] = [
  // [base, isolated, final, initial, medial]
  [0x0622, 0xFE82, 0xFE82, 0xFE81, 0xFE81], // Alef madda
  [0x0623, 0xFE84, 0xFE84, 0xFE83, 0xFE83], // Alef hamza above
  [0x0624, 0xFE86, 0xFE86, 0xFE85, 0xFE85], // Waw hamza above
  [0x0625, 0xFE88, 0xFE88, 0xFE87, 0xFE87], // Alef hamza below
  [0x0626, 0xFE8A, 0xFE8B, 0xFE8C, 0xFE89], // Yeh hamza above
  [0x0627, 0xFE8E, 0xFE8E, 0xFE8D, 0xFE8D], // Alef
  [0x0628, 0xFE8F, 0xFE90, 0xFE91, 0xFE92], // Beh
  [0x0629, 0xFE93, 0xFE94, 0xFE93, 0xFE94], // Teh marbuta
  [0x062A, 0xFE95, 0xFE96, 0xFE97, 0xFE98], // Teh
  [0x062B, 0xFE99, 0xFE9A, 0xFE9B, 0xFE9C], // Theh
  [0x062C, 0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0], // Jeem
  [0x062D, 0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4], // Hah
  [0x062E, 0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8], // Khah
  [0x062F, 0xFEAA, 0xFEAA, 0xFEA8, 0xFEAA], // Dal
  [0x0630, 0xFEAC, 0xFEAC, 0xFEAB, 0xFEAC], // Thal
  [0x0631, 0xFEAE, 0xFEAE, 0xFEAD, 0xFEAE], // Reh
  [0x0632, 0xFEB0, 0xFEB0, 0xFEAF, 0xFEB0], // Zain
  [0x0633, 0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4], // Seen
  [0x0634, 0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8], // Sheen
  [0x0635, 0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC], // Sad
  [0x0636, 0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0], // Dad
  [0x0637, 0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4], // Tah
  [0x0638, 0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8], // Zah
  [0x0639, 0xFEC9, 0xFECA, 0xFECB, 0xFECC], // Ain
  [0x063A, 0xFECD, 0xFECE, 0xFECF, 0xFED0], // Ghain
  [0x0641, 0xFED1, 0xFED2, 0xFED3, 0xFED4], // Feh
  [0x0642, 0xFED5, 0xFED6, 0xFED7, 0xFED8], // Qaf
  [0x0643, 0xFED9, 0xFEDA, 0xFEDB, 0xFEDC], // Kaf
  [0x0644, 0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0], // Lam
  [0x0645, 0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4], // Meem
  [0x0646, 0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8], // Noon
  [0x0647, 0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC], // Heh
  [0x0648, 0xFEEE, 0xFEEE, 0xFEED, 0xFEEE], // Waw
  [0x0649, 0xFEF0, 0xFEF0, 0xFEEF, 0xFEF0], // Alef maksura
  [0x064A, 0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4], // Yeh
];

for (const [base, isolated, final_, initial, medial] of FORM_ENTRIES) {
  FORM_MAP.set(base, [isolated, final_, initial, medial]);
}

// -- Shaping output --

export interface ShapedGlyph {
  readonly codePoint: number;
  readonly original: number;
  readonly form: "ISOLATED" | "FINAL" | "INITIAL" | "MEDIAL" | "UNCHANGED";
}

export interface ShapedRun {
  readonly glyphs: readonly ShapedGlyph[];
  readonly text: string;
}

/**
 * Determine the joining type of a code point.
 * Returns undefined for non-Arabic characters.
 */
const getJoiningType = (cp: number): JoiningType | undefined => {
  // Check if this is an Arabic code point
  const isArabic =
    (cp >= 0x0600 && cp <= 0x06FF) ||
    (cp >= 0x0750 && cp <= 0x077F) ||
    (cp >= 0x08A0 && cp <= 0x08FF) ||
    (cp >= 0xFB50 && cp <= 0xFDFF) ||
    (cp >= 0xFE70 && cp <= 0xFEFC);

  if (!isArabic) return undefined;
  return JOINING_TYPES.get(cp) ?? J.U;
};

/**
 * Check if a joining type is a "joiner" (can participate in connecting to the next char).
 */
const isJoiner = (t: JoiningType | undefined): boolean =>
  t === J.D || t === J.L || t === J.R;

/**
 * Find the first non-transparent joining type to the right (toward end).
 */
const nextJoiningType = (
  chars: readonly number[],
  startIndex: number,
): JoiningType | undefined => {
  for (let i = startIndex; i < chars.length; i += 1) {
    const cp = chars[i]!;
    const jt = getJoiningType(cp);
    if (jt !== J.T) return jt;
  }
  return undefined;
};

/**
 * Find the first non-transparent joining type to the left (toward start).
 */
const prevJoiningType = (
  chars: readonly number[],
  startIndex: number,
): JoiningType | undefined => {
  for (let i = startIndex; i >= 0; i -= 1) {
    const cp = chars[i]!;
    const jt = getJoiningType(cp);
    if (jt !== J.T) return jt;
  }
  return undefined;
};

/**
 * Shape a text string into a run of Arabic-presentation-form glyphs.
 *
 * @param text - input text (may contain mixed Arabic/Latin)
 * @returns shaped glyph run
 */
export const shapeArabic = (text: string): ShapedRun => {
  const chars = [...text].map((c) => c.charCodeAt(0));
  const glyphs: ShapedGlyph[] = [];
  const len = chars.length;

  for (let i = 0; i < len; i += 1) {
    const cp = chars[i]!;
    const jt = getJoiningType(cp);

    // Non-Arabic characters pass through unchanged
    if (jt === undefined) {
      glyphs.push({ codePoint: cp, original: cp, form: "UNCHANGED" });
      continue;
    }

    // Transparent (combining marks): pass through
    if (jt === J.T) {
      glyphs.push({ codePoint: cp, original: cp, form: "UNCHANGED" });
      continue;
    }

    // Check for lam-alef ligature
    // Lam (0x0644) followed by alef (0x0622-0x0625) forms the lam-alef ligature
    if (cp === 0x0644 && i + 1 < len) {
      // Skip transparent chars for the check
      let alefIdx = i + 1;
      while (alefIdx < len && getJoiningType(chars[alefIdx]!) === J.T) {
        alefIdx += 1;
      }

      if (alefIdx < len) {
        const alefCP = chars[alefIdx]!;
        let ligatureCP = -1;

        // Lam + Alef combos
        if (alefCP === 0x0622) ligatureCP = 0xFEF6; // Lam + Alef madda
        else if (alefCP === 0x0623) ligatureCP = 0xFEF6; // Lam + Alef hamza above -> same
        else if (alefCP === 0x0625) ligatureCP = 0xFEF8; // Lam + Alef hamza below
        else if (alefCP === 0x0627) {
          // Determine ligature form based on context
          const prevJT = prevJoiningType(chars, i - 1);
          const nextNextJT = nextJoiningType(chars, alefIdx + 1);
          const hasPrevJoiner = prevJT !== undefined && isJoiner(prevJT);
          const hasNextJoiner = nextNextJT !== undefined && isJoiner(nextNextJT);

          if (hasPrevJoiner && hasNextJoiner) ligatureCP = 0xFEFB; // Medial lam-alef
          else if (hasPrevJoiner) ligatureCP = 0xFEFC; // Final lam-alef
          else if (hasNextJoiner) ligatureCP = 0xFEF9; // Initial lam-alef
          else ligatureCP = 0xFEFA; // Isolated lam-alef
        }

        if (ligatureCP >= 0) {
          const ligPrevJT = prevJoiningType(chars, i - 1);
          const ligNextJT = nextJoiningType(chars, alefIdx + 1);
          const hasPrev = ligPrevJT !== undefined && isJoiner(ligPrevJT);

          let form: "ISOLATED" | "FINAL" | "INITIAL" | "MEDIAL" = "ISOLATED";
          if (hasPrev && ligNextJT !== undefined && isJoiner(ligNextJT)) form = "MEDIAL";
          else if (hasPrev) form = "FINAL";
          else if (ligNextJT !== undefined && isJoiner(ligNextJT)) form = "INITIAL";

          glyphs.push({ codePoint: ligatureCP, original: cp, form });
          i = alefIdx; // Skip the alef, we consumed it
          continue;
        }
      }
    }

    // Check if mapping exists in form table
    const forms = FORM_MAP.get(cp);
    if (!forms) {
      glyphs.push({ codePoint: cp, original: cp, form: "UNCHANGED" });
      continue;
    }

    const [isolated, final_, initial, medial] = forms;

    // Determine context for form selection
    const prevJT = prevJoiningType(chars, i - 1);
    const nextJT = nextJoiningType(chars, i + 1);
    const hasPrev = prevJT !== undefined && isJoiner(prevJT);
    const hasNext = nextJT !== undefined && isJoiner(nextJT);

    // Also check if THIS character can join (R joins only prev, D joins both)
    const canJoinPrev = jt === J.D || jt === J.R;
    const canJoinNext = jt === J.D || jt === J.L;

    let codePoint: number;
    let form: "ISOLATED" | "FINAL" | "INITIAL" | "MEDIAL";

    if (canJoinPrev && hasPrev && canJoinNext && hasNext) {
      codePoint = medial;
      form = "MEDIAL";
    } else if (canJoinPrev && hasPrev) {
      codePoint = final_;
      form = "FINAL";
    } else if (canJoinNext && hasNext) {
      codePoint = initial;
      form = "INITIAL";
    } else {
      codePoint = isolated;
      form = "ISOLATED";
    }

    glyphs.push({ codePoint, original: cp, form });
  }

  return {
    glyphs: Object.freeze(glyphs),
    text,
  };
};

/**
 * Get the shaped code point sequence as an array of character strings.
 */
export const shapedCodePoints = (text: string): readonly number[] =>
  shapeArabic(text).glyphs.map((g) => g.codePoint);

/**
 * Get the shaped text string (for measurement).
 */
export const shapedText = (text: string): string =>
  shapeArabic(text).glyphs
    .map((g) => String.fromCodePoint(g.codePoint))
    .join("");

/**
 * Shape Arabic text with bidi-aware directional runs.
 *
 * This function:
 * 1. Splits text into bidi directional runs using BidiProcessor
 * 2. Applies Arabic shaping within each run independently
 * 3. Does NOT shape Arabic letters across directional boundaries
 * 4. For RTL runs, reverses the shaped glyphs to visual order
 * 5. Concatenates runs in visual order
 *
 * NOTE: Uses require() in function body to avoid ESM import of
 * BidiProcessor at module level, since BidiProcessor is a separate
 * concern that may not always be needed.
 *
 * @param text - input text in logical order
 * @param direction - base paragraph direction ("LTR" | "RTL")
 * @returns shaped and reordered text in visual order
 */
export const shapeWithBidi = (text: string, direction: string): string => {
  const result = reorderBidi(text, direction);

  // Shape each bidi run independently
  const chars = [...text];
  const visualGlyphs: string[] = [];

  // Within each run, shape the run's text independently
  for (const run of result.runs) {
    const runText = run.chars.map((bc: { originalIndex: number }) => chars[bc.originalIndex]!).join("");
    const shapedRun = shapeArabic(runText);
    const shapedChars = shapedRun.glyphs.map((g) => String.fromCodePoint(g.codePoint));

    // For RTL runs, reverse the shaped characters within the run (visual order)
    const visualRun = run.direction === "R" ? [...shapedChars].reverse() : shapedChars;
    visualGlyphs.push(...visualRun);
  }

  return visualGlyphs.join("");
};
