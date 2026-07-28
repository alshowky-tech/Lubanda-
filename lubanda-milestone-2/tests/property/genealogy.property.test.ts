import fc from "fast-check";
import { computeSourceChecksum } from "../../src/core/genealogy/checksum.js";
import { detectCyclePaths } from "../../src/core/validation/cycle-detection.js";
import { row } from "../helpers/genealogy-builders.js";

describe("genealogy properties", () => {
  it("trees whose parent index always precedes child index are acyclic", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 200 }), (size) => {
        const rows = Array.from({ length: size }, (_, index) => ({
          id: String(index + 1),
          parentId: index === 0 ? null : String(Math.floor((index - 1) / 2) + 1),
        }));
        expect(detectCyclePaths(rows)).toEqual([]);
      }),
    );
  });

  it("checksum is invariant to input array ordering", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uniqueArray(fc.integer({ min: 1, max: 10_000 }), {
          minLength: 1,
          maxLength: 40,
        }),
        async (ids) => {
          const rows = ids.map((id, index) =>
            row(String(id), `Person ${id}`, null, 1, index + 2),
          );
          expect(await computeSourceChecksum(rows)).toBe(
            await computeSourceChecksum([...rows].reverse()),
          );
        },
      ),
    );
  });
});

