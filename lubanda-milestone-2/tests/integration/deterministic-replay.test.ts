import { asProjectId, asRevisionId } from "../../src/core/contracts/identifiers.js";
import { buildAcceptedGenealogySnapshot } from "../../src/core/genealogy/snapshot.js";
import { XlsxGenealogyImporter } from "../../src/core/import/WorkbookImporter.js";
import { GenealogyValidator } from "../../src/core/validation/validator.js";
import { validWorkbookBuffer } from "../helpers/workbook-builders.js";

describe("deterministic replay", () => {
  it("reproduces byte-identical serialized snapshots for fixed metadata", async () => {
    const importer = new XlsxGenealogyImporter();
    const buffer = validWorkbookBuffer();
    const first = await importer.importWorkbook(buffer);
    const second = await importer.importWorkbook(buffer);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.value.sourceChecksum).toBe(second.value.sourceChecksum);
    const firstReport = new GenealogyValidator().validate(first.value);
    const secondReport = new GenealogyValidator().validate(second.value);
    if (!firstReport.accepted || !secondReport.accepted) {
      throw new Error("Synthetic workbook unexpectedly failed validation");
    }
    const metadata = {
      projectId: asProjectId("project"),
      revisionId: asRevisionId("revision"),
      createdAt: "2026-07-27T00:00:00.000Z",
    };
    expect(
      JSON.stringify(buildAcceptedGenealogySnapshot(firstReport, metadata)),
    ).toBe(
      JSON.stringify(buildAcceptedGenealogySnapshot(secondReport, metadata)),
    );
  });
});
