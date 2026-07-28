import { describe, expect, it } from "vitest";
import { canonicalJson } from "../../src/core/determinism/index.js";
import { syntheticSnapshot } from "../helpers/genealogy-builders.js";
import {
  planSnapshot,
  rectangularTemplate,
} from "../helpers/territory-builders.js";

describe("Milestone 2 territory scenarios", () => {
  it.each([
    ["linear", 100, "LINEAR"],
    ["many children", 100, "STAR"],
    ["unbalanced", 100, "UNBALANCED"],
    ["balanced", 100, "BALANCED"],
  ] as const)("handles %s genealogy", async (_name, size, shape) => {
    const { result } = await planSnapshot(
      syntheticSnapshot({ size, shape }),
      rectangularTemplate(8_000, 5_000),
    );
    expect(result.ok).toBe(true);
  });

  it("is independent of source row order after canonical graph construction", async () => {
    const first = await planSnapshot(
      syntheticSnapshot({ size: 100, shape: "BALANCED" }),
      rectangularTemplate(8_000, 5_000),
    );
    const second = await planSnapshot(
      syntheticSnapshot({
        size: 100,
        shape: "BALANCED",
        reverseRows: true,
      }),
      rectangularTemplate(8_000, 5_000),
    );
    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    if (!first.result.ok || !second.result.ok) return;
    expect(first.result.value.deterministicFingerprint).toBe(
      second.result.value.deterministicFingerprint,
    );
    expect(canonicalJson(first.result.value)).toBe(
      canonicalJson(second.result.value),
    );
  });

  it("produces byte-identical replay output", async () => {
    const snapshot = syntheticSnapshot({ size: 500, shape: "BALANCED" });
    const first = await planSnapshot(snapshot, rectangularTemplate(16_000, 9_000), 781);
    const second = await planSnapshot(snapshot, rectangularTemplate(16_000, 9_000), 781);
    expect(first.result.ok).toBe(true);
    expect(second.result.ok).toBe(true);
    if (!first.result.ok || !second.result.ok) return;
    expect(JSON.stringify(second.result.value)).toBe(
      JSON.stringify(first.result.value),
    );
  }, 20_000);

  it.each([10, 100, 500, 1_000])(
    "completes scale fixture of %i people",
    async (size) => {
      const width = Math.max(8_000, size * 30);
      const { result } = await planSnapshot(
        syntheticSnapshot({ size, shape: "BALANCED" }),
        rectangularTemplate(width, width * 0.62),
        19,
      );
      expect(result.ok).toBe(true);
    },
    20_000,
  );
});
