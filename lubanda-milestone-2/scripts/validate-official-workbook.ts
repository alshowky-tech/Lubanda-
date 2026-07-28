import fs from "node:fs/promises";
import path from "node:path";
import { XlsxGenealogyImporter } from "../src/core/import/WorkbookImporter.js";
import { GenealogyValidator } from "../src/core/validation/validator.js";

const workbookPath = process.env.LUBANDA_OFFICIAL_WORKBOOK;
if (!workbookPath) {
  throw new Error("LUBANDA_OFFICIAL_WORKBOOK must point to the official .xlsx file");
}

const bytes = await fs.readFile(workbookPath);
const imported = await new XlsxGenealogyImporter().importWorkbook(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
);
const outputPath = path.resolve("artifacts/official-workbook-validation.json");
await fs.mkdir(path.dirname(outputPath), { recursive: true });

if (!imported.ok) {
  await fs.writeFile(
    outputPath,
    JSON.stringify({ imported: false, errors: imported.errors }, null, 2),
  );
  process.exitCode = 1;
} else {
  const report = new GenealogyValidator().validate(imported.value);
  const issueCounts = Object.fromEntries(
    [...new Set(report.issues.map((issue) => issue.code))]
      .sort()
      .map((code) => [
        code,
        report.issues.filter((issue) => issue.code === code).length,
      ]),
  );
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        imported: true,
        sheetName: imported.value.sheetName,
        normalizedRowCount: imported.value.normalizedRows.length,
        ignoredRowCount: imported.value.ignoredRowNumbers.length,
        sourceChecksum: imported.value.sourceChecksum,
        accepted: report.accepted,
        statistics: report.statistics,
        issueCounts,
        issues: report.issues,
      },
      null,
      2,
    ),
  );
  if (!report.accepted) process.exitCode = 2;
}
console.log(outputPath);

