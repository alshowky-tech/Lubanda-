import { XlsxGenealogyImporter } from "../../../src/core/import/WorkbookImporter.js";
import {
  REQUIRED_HEADERS,
  validWorkbookBuffer,
  workbookBuffer,
} from "../../helpers/workbook-builders.js";

describe("XlsxGenealogyImporter", () => {
  it("imports and normalizes a valid workbook while preserving leading zeros", async () => {
    const result = await new XlsxGenealogyImporter().importWorkbook(
      validWorkbookBuffer(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.normalizedRows).toHaveLength(3);
    expect(result.value.normalizedRows[0]?.id).toBe("001");
    expect(result.value.rootCandidateIds).toEqual(["001"]);
    expect(result.value.sourceChecksum).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("produces a preview with missing-column issues", async () => {
    const result = await new XlsxGenealogyImporter().importWorkbook(
      workbookBuffer([["id", "name"], ["1", "محمد"]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.issues.filter((item) => item.code === "MISSING_COLUMN")).toHaveLength(
      2,
    );
  });

  it("ignores fully blank data rows", async () => {
    const result = await new XlsxGenealogyImporter().importWorkbook(
      workbookBuffer([REQUIRED_HEADERS, ["1", "محمد", null, 1], [null, null, null, null]]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.normalizedRows).toHaveLength(1);
  });

  it("rejects empty and invalid containers", async () => {
    const importer = new XlsxGenealogyImporter();
    const empty = await importer.importWorkbook(new ArrayBuffer(0));
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.errors[0]?.code).toBe("EMPTY_FILE");

    const invalid = await importer.importWorkbook(
      new TextEncoder().encode("not a workbook").buffer,
    );
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors[0]?.code).toBe("MALFORMED_VALUE");
  });
});

