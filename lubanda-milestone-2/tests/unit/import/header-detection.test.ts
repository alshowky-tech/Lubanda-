import { detectHeader } from "../../../src/core/import/detect-header.js";
import { REQUIRED_HEADERS } from "../../helpers/workbook-builders.js";

describe("header detection", () => {
  it("finds Arabic headers after introductory rows", () => {
    const result = detectHeader(
      [["مقدمة"], REQUIRED_HEADERS, ["1", "محمد", null, 1]],
      5,
    );
    expect(result?.rowIndex).toBe(1);
    expect(result?.missingRequired).toEqual([]);
    expect(result?.mappedColumns.map((item) => item.field)).toEqual([
      "id",
      "name",
      "parentId",
      "generation",
    ]);
  });

  it("reports missing required fields without guessing", () => {
    const result = detectHeader([["id", "name"]], 1);
    expect(result?.missingRequired).toEqual(["parentId", "generation"]);
  });
});

