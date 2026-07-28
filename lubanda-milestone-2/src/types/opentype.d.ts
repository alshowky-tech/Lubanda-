declare module "opentype.js" {
  export interface Glyph {
    readonly index: number;
    readonly name: string;
    readonly unicode: number | undefined;
    readonly unicodes: number[];
    readonly advanceWidth: number;
    readonly xMin: number;
    readonly yMin: number;
    readonly xMax: number;
    readonly yMax: number;
    readonly numberOfContours: number;
  }

  export interface GlyphSet {
    readonly length: number;
    get(index: number): Glyph;
  }

  export interface FontNames {
    readonly fontFamily?: { readonly en?: string };
    readonly fontSubfamily?: { readonly en?: string };
    readonly fullName?: { readonly en?: string };
    readonly postScriptName?: { readonly en?: string };
  }

  export interface Font {
    readonly names: FontNames;
    readonly unitsPerEm: number;
    readonly glyphs: GlyphSet;
    readonly ascender: number;
    readonly descender: number;
    charToGlyph(c: string): Glyph;
    stringToGlyphs(s: string): Glyph[];
    getPath(text: string, x: number, y: number, fontSize: number, options?: { kerning?: boolean }): { toPathData(): string };
    getAdvanceWidth(text: string, fontSize: number, options?: { kerning?: boolean }): number;
    kernPairs: Record<string, number>;
  }

  export function parse(buffer: ArrayBuffer | Buffer): Font;
  export function load(url: string, callback: (err: Error | null, font?: Font) => void): void;
  export function loadSync(url: string): Font;
}
