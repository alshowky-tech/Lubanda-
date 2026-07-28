import {
  canonicalizeNormalizedRows,
  computeSourceChecksum,
} from "../../../src/core/genealogy/checksum.js";
import { row } from "../../helpers/genealogy-builders.js";

describe("source checksum", () => {
  it("uses canonical order and explicit nulls", async () => {
    const first = [row("2", "ابن", "1", 2, 3), row("1", "أب", null, 1, 2)];
    const second = [...first].reverse();
    expect(canonicalizeNormalizedRows(first)).toContain('"parentId":null');
    expect(await computeSourceChecksum(first)).toBe(await computeSourceChecksum(second));
  });

  it("changes when normalized content changes", async () => {
    expect(await computeSourceChecksum([row("1", "أ", null, 1, 2)])).not.toBe(
      await computeSourceChecksum([row("1", "ب", null, 1, 2)]),
    );
  });
});

