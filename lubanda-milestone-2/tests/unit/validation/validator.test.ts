import { GenealogyValidator } from "../../../src/core/validation/validator.js";
import { preview, row } from "../../helpers/genealogy-builders.js";

describe("GenealogyValidator", () => {
  const validator = new GenealogyValidator();

  it("accepts valid strict generations", async () => {
    const report = validator.validate(
      await preview([
        row("1", "محمد", null, 1, 2),
        row("2", "مهدي", "1", 2, 3),
      ]),
    );
    expect(report.accepted).toBe(true);
    expect(report.errors).toEqual([]);
    if (report.accepted) expect(report.genealogy.persons).toHaveLength(2);
  });

  it("blocks a header-only preview from becoming an accepted genealogy", async () => {
    const report = validator.validate(await preview([]));
    expect(report.accepted).toBe(false);
    expect(report.issues.map((entry) => entry.code)).toContain("EMPTY_FILE");
    expect(report.issues.map((entry) => entry.code)).not.toContain("NO_ROOT");
  });

  it.each([
    {
      name: "empty ID",
      rows: [row(null, "محمد", null, 1, 2)],
      code: "EMPTY_ID",
    },
    {
      name: "empty name",
      rows: [row("1", null, null, 1, 2)],
      code: "EMPTY_NAME",
    },
    {
      name: "duplicate ID",
      rows: [row("1", "أ", null, 1, 2), row("1", "ب", null, 1, 3)],
      code: "DUPLICATE_ID",
    },
    {
      name: "self parent",
      rows: [row("1", "أ", "1", 1, 2)],
      code: "SELF_PARENT",
    },
    {
      name: "missing parent",
      rows: [row("1", "أ", "404", 2, 2)],
      code: "MISSING_PARENT",
    },
    {
      name: "no root",
      rows: [row("1", "أ", "2", 2, 2), row("2", "ب", "1", 3, 3)],
      code: "NO_ROOT",
    },
    {
      name: "cycle",
      rows: [row("1", "أ", "2", 2, 2), row("2", "ب", "1", 3, 3)],
      code: "CYCLE",
    },
    {
      name: "malformed generation",
      rows: [row("1", "أ", null, null, 2)],
      code: "MALFORMED_VALUE",
    },
    {
      name: "generation mismatch",
      rows: [row("1", "أ", null, 1, 2), row("2", "ب", "1", 4, 3)],
      code: "GENERATION_MISMATCH",
    },
  ] as const)("blocks $name", async ({ rows, code }) => {
    const report = validator.validate(await preview(rows));
    expect(report.accepted).toBe(false);
    expect(report.issues.some((entry) => entry.code === code)).toBe(true);
  });

  it("allows multiple roots in preview with policy-controlled severity", async () => {
    const input = await preview([
      row("1", "أ", null, 1, 2),
      row("2", "ب", null, 1, 3),
    ]);
    const warning = validator.validate(input);
    expect(warning.accepted).toBe(true);
    expect(warning.issues.find((entry) => entry.code === "MULTIPLE_ROOTS")?.severity).toBe(
      "WARNING",
    );

    const blocking = validator.validate(input, {
      version: "1.0",
      rootGenerationBaseline: 1,
      multipleRootsSeverity: "ERROR",
    });
    expect(blocking.accepted).toBe(false);
  });

  it("does not treat people outside a selected future render root as unreachable", async () => {
    const report = validator.validate(
      await preview([
        row("1", "أ", null, 1, 2),
        row("2", "ب", "1", 2, 3),
        row("10", "ج", null, 1, 4),
      ]),
    );
    expect(report.issues.some((entry) => entry.code === "UNREACHABLE_PERSON")).toBe(false);
  });

  it("does not repair genealogy", async () => {
    const input = await preview([row("1", "أ", "missing", 2, 2)]);
    const before = JSON.stringify(input.normalizedRows);
    validator.validate(input);
    expect(JSON.stringify(input.normalizedRows)).toBe(before);
  });
});
