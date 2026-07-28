import fs from "node:fs/promises";
import { asProjectId, asRevisionId } from "../../src/core/contracts/identifiers.js";
import { buildGenealogyGraph } from "../../src/core/genealogy/graph.js";
import { buildAcceptedGenealogySnapshot } from "../../src/core/genealogy/snapshot.js";
import { XlsxGenealogyImporter } from "../../src/core/import/WorkbookImporter.js";
import { GenealogyValidator } from "../../src/core/validation/validator.js";
import { validWorkbookBuffer } from "../helpers/workbook-builders.js";

describe("workbook to graph integration", () => {
  it("runs the approved lifecycle for a valid workbook", async () => {
    const imported = await new XlsxGenealogyImporter().importWorkbook(
      validWorkbookBuffer(),
    );
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const report = new GenealogyValidator().validate(imported.value);
    expect(report.accepted).toBe(true);
    if (!report.accepted) return;
    const snapshot = buildAcceptedGenealogySnapshot(report, {
      projectId: asProjectId("project"),
      revisionId: asRevisionId("revision"),
      createdAt: "2026-07-27T00:00:00.000Z",
    });
    const graph = buildGenealogyGraph(snapshot);
    expect(graph.personsById.size).toBe(3);
    expect(JSON.parse(JSON.stringify(snapshot)).persons).toHaveLength(3);
  });

  it("cannot build an accepted snapshot from a blocking validation report", async () => {
    const imported = await new XlsxGenealogyImporter().importWorkbook(
      validWorkbookBuffer(),
    );
    if (!imported.ok) throw new Error("Synthetic workbook import failed");
    const invalidPreview = {
      ...imported.value,
      normalizedRows: imported.value.normalizedRows.map((row, index) =>
        index === 1 ? { ...row, parentId: "missing" } : row,
      ),
    };
    const report = new GenealogyValidator().validate(invalidPreview);
    expect(report.accepted).toBe(false);
    expect(() =>
      buildAcceptedGenealogySnapshot(report, {
        projectId: asProjectId("project"),
        revisionId: asRevisionId("revision"),
        createdAt: "2026-07-27T00:00:00.000Z",
      }),
    ).toThrow(/blocking validation issues/u);
  });

  const officialPath = process.env.LUBANDA_OFFICIAL_WORKBOOK;
  it.runIf(Boolean(officialPath))(
    "imports and validates the official 1,386-person workbook without persisting it",
    async () => {
      const bytes = await fs.readFile(officialPath as string);
      const imported = await new XlsxGenealogyImporter().importWorkbook(
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      );
      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      expect(imported.value.sheetName).toBe("السلسلة الشوكية الهاشمية");
      expect(imported.value.normalizedRows).toHaveLength(1_386);
      const report = new GenealogyValidator().validate(imported.value);
      expect(report.statistics.rowCount).toBe(1_386);
      if (report.accepted) {
        expect(report.genealogy.persons).toHaveLength(1_386);
      }
    },
  );
});
