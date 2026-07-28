import type { TextMeasureRequest, TextMetricsResult, TypographyCacheKey } from "./types.js";

/**
 * Deterministic typography measurement cache.
 * Cache key is derived from the full typography request for deterministic
 * repeatability. Cache hits produce byte-identical results.
 */
export class TypographyCache {
  readonly #store = new Map<string, TextMetricsResult>();
  #hits = 0;
  #misses = 0;

  get hits(): number {
    return this.#hits;
  }

  get misses(): number {
    return this.#misses;
  }

  get size(): number {
    return this.#store.size;
  }

  /**
   * Build a deterministic cache key from a TextMeasureRequest.
   */
  static buildKey(request: TextMeasureRequest): string {
    const key: TypographyCacheKey = {
      text: request.text,
      fontFamily: request.fontFamily,
      fontSize: request.fontSize,
      fontWeight: request.fontWeight,
      letterSpacing: request.letterSpacing,
      direction: request.direction,
      maximumWidth: request.maximumWidth,
      lineCountPolicy: request.lineCountPolicy,
      maximumLines: request.maximumLines,
    };
    return JSON.stringify(key);
  }

  /**
   * Retrieve a cached measurement result.
   */
  get(request: TextMeasureRequest): TextMetricsResult | undefined {
    const key = TypographyCache.buildKey(request);
    const result = this.#store.get(key);
    if (result !== undefined) {
      this.#hits += 1;
    }
    return result;
  }

  /**
   * Store a measurement result in the cache.
   */
  set(request: TextMeasureRequest, result: TextMetricsResult): void {
    const key = TypographyCache.buildKey(request);
    this.#store.set(key, result);
    this.#misses += 1;
  }

  /**
   * Clear the cache.
   */
  clear(): void {
    this.#store.clear();
    this.#hits = 0;
    this.#misses = 0;
  }
}
