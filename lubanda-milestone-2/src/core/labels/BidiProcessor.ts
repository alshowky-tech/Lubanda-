/**
 * Deterministic Unicode Bidirectional Algorithm (UAX #9) implementation
 * for mixed RTL/LTR text reordering.
 *
 * Implements implicit directional runs: P2–P3, W1–W7, N1–N2, I1–I2, L2.
 * Explicit formatting characters (LRE, RLE, LRO, RLO, PDF, LRI, RLI, FSI, PDI)
 * are not implemented — this is sufficient for plain label text.
 *
 * Key design for numeric integrity:
 * - AN and EN digits get level = baseLevel + 2, placing them ABOVE strong R
 *   in RTL paragraphs. The L2 reorder then reverses higher-level runs first,
 *   followed by lower-level runs, so digit sequences emerge in correct order.
 *
 * Fully deterministic: same input + base direction → same output.
 */

export type BidiType =
  | "L" | "R" | "EN" | "ES" | "ET" | "AN" | "CS" | "NSM" | "BN" | "B" | "S" | "WS" | "ON";

const BC = new Map<number, BidiType>();
const R = (s: number, e: number, t: BidiType) => { for (let cp = s; cp <= e; cp += 1) BC.set(cp, t); };
const S = (cps: number[], t: BidiType) => { for (const cp of cps) BC.set(cp, t); };

R(0x0041, 0x005A, "L"); R(0x0061, 0x007A, "L"); R(0x00C0, 0x02AF, "L");
R(0x0370, 0x03FF, "L"); R(0x0400, 0x04FF, "L"); R(0xFB00, 0xFB06, "L");
R(0x0590, 0x05FF, "R"); R(0x0600, 0x06FF, "R"); R(0x0700, 0x074F, "R");
R(0x0750, 0x077F, "R"); R(0x08A0, 0x08FF, "R"); R(0xFB50, 0xFDFF, "R"); R(0xFE70, 0xFEFC, "R");
R(0x0660, 0x0669, "AN"); R(0x0030, 0x0039, "EN");
BC.set(0x002B, "ES"); BC.set(0x002D, "ES"); BC.set(0x0023, "ET"); BC.set(0x0025, "ET");
BC.set(0x00B0, "ET"); BC.set(0x0024, "ET"); BC.set(0x002C, "CS"); BC.set(0x002E, "CS");
BC.set(0x002F, "CS"); BC.set(0x003A, "CS");
R(0x0300, 0x036F, "NSM"); R(0x064B, 0x065F, "NSM"); R(0x06D6, 0x06DC, "NSM");
R(0x06DF, 0x06E4, "NSM"); R(0x06E7, 0x06E8, "NSM"); R(0x06EA, 0x06ED, "NSM");
BC.set(0x0670, "NSM");
S([0x0009, 0x000B, 0x000C, 0x0020, 0x00A0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200A, 0x202F, 0x205F, 0x3000], "WS");
BC.set(0x000D, "B"); BC.set(0x000A, "B"); BC.set(0x0085, "B"); BC.set(0x2028, "B"); BC.set(0x2029, "B");
S([0x0021, 0x0022, 0x0026, 0x0027, 0x0028, 0x0029, 0x002A, 0x003C, 0x003D, 0x003E, 0x003F, 0x0040, 0x005B, 0x005C, 0x005D, 0x005E, 0x005F, 0x0060, 0x007B, 0x007C, 0x007D, 0x007E, 0x00A1, 0x00A7, 0x00AB, 0x00B6, 0x00B7, 0x00BB, 0x00BF, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015, 0x2016, 0x2017, 0x2018, 0x2019, 0x201A, 0x201B, 0x201C, 0x201D, 0x201E, 0x201F, 0x2020, 0x2021, 0x2022, 0x2026], "ON");

const getBT = (cp: number): BidiType => BC.get(cp) ?? "ON";

export interface BidiChar { readonly codePoint: number; readonly originalIndex: number; readonly bidiType: BidiType; readonly level: number; }
export interface BidiRun { readonly chars: readonly BidiChar[]; readonly level: number; readonly direction: "L" | "R"; }
export interface BidiResult { readonly runs: readonly BidiRun[]; readonly visualOrder: readonly number[]; }

/**
 * UAX #9 reorderBidi with proper I1 level resolution and L2 visual reorder.
 *
 * I1 (implicit levels):
 *   L, EN → next even ≥ baseLevel
 *   R     → next odd ≥ baseLevel
 *   AN    → baseLevel + 2 (ensuring AN > R in RTL, > L in LTR)
 *
 * L2: from highest level down to lowest odd, reverse each contiguous
 *     sequence of characters at level ≥ current level.
 */
export const reorderBidi = (text: string, direction: string): BidiResult => {
  const chars = [...text];
  const n = chars.length;
  const baseLevel = direction === "RTL" ? 1 : 0;

  // P2–P3: classify
  const bcs: BidiChar[] = chars.map((ch, i) => ({
    codePoint: ch.charCodeAt(0), originalIndex: i,
    bidiType: getBT(ch.charCodeAt(0)), level: baseLevel,
  }));

  // W1: NSM follows preceding
  for (let i = 1; i < n; i += 1) {
    if (bcs[i]!.bidiType === "NSM") bcs[i] = { ...bcs[i]!, bidiType: bcs[i - 1]!.bidiType };
  }

  // W2: EN in RTL context → AN
  for (let i = 0; i < n; i += 1) {
    if (bcs[i]!.bidiType !== "EN") continue;
    let strong: BidiType | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      const t = bcs[j]!.bidiType;
      if (t === "L" || t === "R") { strong = t; break; }
    }
    if (strong === "R") bcs[i] = { ...bcs[i]!, bidiType: "AN" };
  }

  // W4: ES/CS between same-type numbers → number
  for (let i = 1; i < n - 1; i += 1) {
    const p = bcs[i - 1]!, c = bcs[i]!, nx = bcs[i + 1]!;
    if (c.bidiType !== "ES" && c.bidiType !== "CS") continue;
    const pn = p.bidiType === "EN" || p.bidiType === "AN";
    const nn = nx.bidiType === "EN" || nx.bidiType === "AN";
    if (pn && nn && p.bidiType === nx.bidiType) bcs[i] = { ...c, bidiType: p.bidiType };
  }

  // W5: ET sequences before EN → EN
  let i5 = 0;
  while (i5 < n) {
    if (bcs[i5]!.bidiType === "ET") {
      let j = i5;
      while (j < n && bcs[j]!.bidiType === "ET") j += 1;
      if (j < n && bcs[j]!.bidiType === "EN") {
        for (let k = i5; k < j; k += 1) bcs[k] = { ...bcs[k]!, bidiType: "EN" };
        i5 = j;
      } else i5 += 1;
    } else i5 += 1;
  }

  // W6: ES/ET/CS → ON
  for (let i = 0; i < n; i += 1) {
    const t = bcs[i]!.bidiType;
    if (t === "ES" || t === "ET" || t === "CS") bcs[i] = { ...bcs[i]!, bidiType: "ON" };
  }

  // N1–N2: neutrals (ON, WS, S, B) resolved by context
  for (let i = 0; i < n; i += 1) {
    const t = bcs[i]!.bidiType;
    if (t !== "ON" && t !== "WS" && t !== "S") continue;
    let left: BidiType | undefined, right: BidiType | undefined;
    for (let j = i - 1; j >= 0; j -= 1) {
      const tj = bcs[j]!.bidiType;
      if (tj === "L" || tj === "R") { left = tj; break; }
    }
    for (let j = i + 1; j < n; j += 1) {
      const tj = bcs[j]!.bidiType;
      if (tj === "L" || tj === "R") { right = tj; break; }
    }
    if (left !== undefined && left === right) bcs[i] = { ...bcs[i]!, bidiType: left };
    else bcs[i] = { ...bcs[i]!, bidiType: baseLevel === 0 ? "L" : "R" };
  }

  // I1: Resolve implicit levels
  // L, EN → next even ≥ baseLevel
  // R     → next odd ≥ baseLevel
  // AN    → baseLevel + 2 (ensuring AN > R in RTL context)
  const resolved = bcs.map((bc) => {
    let level: number;
    switch (bc.bidiType) {
      case "L":
      case "EN":
        level = baseLevel + (baseLevel % 2);
        break;
      case "R":
        level = baseLevel + (1 - (baseLevel % 2));
        break;
      case "AN":
        level = baseLevel + 2;
        break;
      default:
        level = baseLevel;
    }
    return { ...bc, level };
  });

  // L2: Visual reorder per UAX #9
  // From the highest level found in the text to the lowest odd level,
  // iterate only over LEVELS THAT ACTUALLY EXIST in the text.
  // Processing non-existent intermediate levels would re-reverse
  // higher-level runs and break digit sequences.
  const order = resolved.map((_, idx) => idx);
  const levels = resolved.map((bc) => bc.level);
  const minOdd = baseLevel % 2 === 1 ? baseLevel : baseLevel + 1;
  // Only process levels that actually appear in the text, descending
  const lvls = [...new Set(levels)].filter((l) => l >= minOdd).sort((a, b) => b - a);

  for (const lvl of lvls) {
    // Find contiguous sequences in CURRENT order where level >= lvl
    let runStart = 0;
    while (runStart < n) {
      if (levels[order[runStart]!]! < lvl) { runStart += 1; continue; }
      let runEnd = runStart;
      while (runEnd < n && levels[order[runEnd]!]! >= lvl) runEnd += 1;
      // Reverse this contiguous run [runStart, runEnd) in-place
      for (let a = runStart, b = runEnd - 1; a < b; a += 1, b -= 1) {
        const tmp = order[a]!; order[a] = order[b]!; order[b] = tmp;
      }
      runStart = runEnd;
    }
  }

  const visualOrder = order.map((idx) => resolved[idx]!.originalIndex);

  // Build logical-order runs
  const runs: { start: number; end: number; level: number }[] = [];
  let rs = 0;
  for (let i = 1; i <= n; i += 1) {
    if (i === n || resolved[i]!.level !== resolved[rs]!.level) {
      runs.push({ start: rs, end: i, level: resolved[rs]!.level });
      rs = i;
    }
  }
  const pubRuns: BidiRun[] = runs.map((r) => ({
    chars: Object.freeze(resolved.slice(r.start, r.end)),
    level: r.level,
    direction: r.level % 2 === 0 ? "L" : "R",
  }));

  return { runs: Object.freeze(pubRuns), visualOrder: Object.freeze(visualOrder) };
};

/** Logical → visual string. */
export const toVisualOrder = (text: string, direction: string): string => {
  const r = reorderBidi(text, direction);
  const chars = [...text];
  return r.visualOrder.map((i) => chars[i]!).join("");
};

/** Logical index → visual position mapping. */
export const logicalToVisual = (text: string, direction: string): readonly number[] => {
  const r = reorderBidi(text, direction);
  const m = new Array<number>(text.length);
  for (let vi = 0; vi < r.visualOrder.length; vi += 1) m[r.visualOrder[vi]!] = vi;
  return Object.freeze(m);
};
