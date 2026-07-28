import { unzipSync } from "fflate";
import type { EngineIssue, StageResult } from "../contracts/index.js";
import { stageFailure, stageSuccess } from "../contracts/index.js";
import { computeSourceChecksum } from "../genealogy/checksum.js";
import {
  isBlankNormalizedRow,
  normalizePersonRow,
} from "../genealogy/normalize.js";
import type { NormalizedPersonRow } from "../genealogy/types.js";
import { detectHeader } from "./detect-header.js";
import { DEFAULT_WORKBOOK_LIMITS } from "./workbook-limits.js";
import type {
  GenealogyImporter,
  ImportOptions,
  ImportPreview,
  WorkbookLimits,
} from "./types.js";
import { inspectZipDirectory } from "./zip-preflight.js";
import { parseXlsxArchive } from "./xlsx-reader.js";

const issue = (
  code: EngineIssue["code"],
  severity: EngineIssue["severity"],
  messageKey: string,
  additional: Partial<EngineIssue> = {},
): EngineIssue => ({
  code,
  severity,
  messageKey,
  stage: "ACQUIRE",
  recoverable: true,
  ...additional,
});

const resolveLimits = (overrides?: Partial<WorkbookLimits>): WorkbookLimits => ({
  ...DEFAULT_WORKBOOK_LIMITS,
  ...overrides,
});

const mergeStartRow = (range: string): number | null => {
  const match = /^[A-Z]+(\d+):[A-Z]+(\d+)$/u.exec(range);
  return match ? Number(match[1]) : null;
};

export class XlsxGenealogyImporter implements GenealogyImporter {
  async importWorkbook(
    input: ArrayBuffer,
    options: ImportOptions = {},
  ): Promise<StageResult<ImportPreview>> {
    const limits = resolveLimits(options.limits);
    const errors: EngineIssue[] = [];

    if (input.byteLength === 0) {
      return stageFailure([
        issue("EMPTY_FILE", "FATAL", "import.emptyFile", { recoverable: false }),
      ]);
    }
    if (input.byteLength > limits.maxFileBytes) {
      return stageFailure([
        issue("MALFORMED_VALUE", "FATAL", "import.fileTooLarge", {
          details: { actualBytes: input.byteLength, maxBytes: limits.maxFileBytes },
          recoverable: false,
        }),
      ]);
    }

    try {
      const zip = inspectZipDirectory(input);
      if (zip.totalUncompressedBytes > limits.maxUncompressedBytes) {
        return stageFailure([
          issue("MALFORMED_VALUE", "FATAL", "import.uncompressedSizeLimit", {
            details: {
              actualBytes: zip.totalUncompressedBytes,
              maxBytes: limits.maxUncompressedBytes,
            },
            recoverable: false,
          }),
        ]);
      }
      const lowerPaths = zip.entries.map((entry) => entry.path.toLocaleLowerCase("en-US"));
      if (lowerPaths.some((path) => path.endsWith("vbaproject.bin"))) {
        return stageFailure([
          issue("MALFORMED_VALUE", "FATAL", "import.macrosNotAllowed", {
            recoverable: false,
          }),
        ]);
      }
      if (lowerPaths.some((path) => path.startsWith("xl/externallinks/"))) {
        return stageFailure([
          issue("MALFORMED_VALUE", "FATAL", "import.externalLinksNotAllowed", {
            recoverable: false,
          }),
        ]);
      }
    } catch (error) {
      return stageFailure([
        issue("MALFORMED_VALUE", "FATAL", "import.invalidZipContainer", {
          details: { reason: error instanceof Error ? error.message : String(error) },
          recoverable: false,
        }),
      ]);
    }

    let workbookSheets: ReturnType<typeof parseXlsxArchive>;
    try {
      const archive = unzipSync(new Uint8Array(input));
      workbookSheets = parseXlsxArchive(archive);
    } catch (error) {
      return stageFailure([
        issue("MALFORMED_VALUE", "FATAL", "import.workbookParseFailed", {
          details: { reason: error instanceof Error ? error.message : String(error) },
          recoverable: false,
        }),
      ]);
    }

    const sheetNames = workbookSheets.map((sheet) => sheet.name);
    if (sheetNames.length > limits.maxSheets) {
      return stageFailure([
        issue("MALFORMED_VALUE", "FATAL", "import.sheetLimitExceeded", {
          details: { actual: sheetNames.length, max: limits.maxSheets },
          recoverable: false,
        }),
      ]);
    }

    const sheetName = options.sheetName ?? sheetNames[0];
    if (!sheetName || !sheetNames.includes(sheetName)) {
      return stageFailure([
        issue("EMPTY_FILE", "FATAL", "import.noWorksheet", { recoverable: false }),
      ]);
    }

    const worksheetInspection = workbookSheets.find((sheet) => sheet.name === sheetName);
    if (!worksheetInspection) {
      return stageFailure([
        issue("MALFORMED_VALUE", "FATAL", "import.worksheetInspectionFailed", {
          details: { reason: `Worksheet data not found: ${sheetName}` },
          recoverable: false,
        }),
      ]);
    }
    if (worksheetInspection.hasExternalFormula) {
      errors.push(
        issue("MALFORMED_VALUE", "FATAL", "import.externalFormulaNotAllowed", {
          recoverable: false,
        }),
      );
    }
    const missingFormulaValueRow = worksheetInspection.formulaWithoutCachedValueRow;
    if (missingFormulaValueRow !== null) {
      errors.push(
        issue("MALFORMED_VALUE", "ERROR", "import.formulaHasNoCachedValue", {
          rowNumber: missingFormulaValueRow,
        }),
      );
    }

    const rows = worksheetInspection.rows;
    if (rows.length === 0) {
      return stageFailure([
        issue("EMPTY_FILE", "FATAL", "import.emptyWorksheet", { recoverable: false }),
      ]);
    }
    const maximumColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
    if (rows.length > limits.maxRows || maximumColumns > limits.maxColumns) {
      return stageFailure([
        issue("MALFORMED_VALUE", "FATAL", "import.dimensionLimitExceeded", {
          details: {
            rows: rows.length,
            columns: maximumColumns,
            maxRows: limits.maxRows,
            maxColumns: limits.maxColumns,
          },
          recoverable: false,
        }),
      ]);
    }

    const detection = detectHeader(rows, options.headerSearchRows ?? 20);
    if (!detection) {
      return stageFailure([
        issue("MISSING_COLUMN", "FATAL", "import.headerNotFound"),
      ]);
    }
    for (const field of detection.missingRequired) {
      errors.push(
        issue("MISSING_COLUMN", "FATAL", "import.missingRequiredColumn", {
          field,
        }),
      );
    }

    for (const mergeRange of worksheetInspection.mergeRanges) {
      const startRow = mergeStartRow(mergeRange);
      if (startRow !== null && startRow > detection.rowIndex + 1) {
        errors.push(
          issue("MALFORMED_VALUE", "ERROR", "import.mergedCellInDataRange", {
            rowNumber: startRow,
            details: { range: mergeRange },
          }),
        );
      }
    }

    const normalizedRows: NormalizedPersonRow[] = [];
    const ignoredRowNumbers: number[] = [];
    for (let index = detection.rowIndex + 1; index < rows.length; index += 1) {
      const sourceRowNumber = index + 1;
      const normalized = normalizePersonRow(
        rows[index] ?? [],
        sourceRowNumber,
        detection.mappedColumns,
      );
      if (isBlankNormalizedRow(normalized)) {
        ignoredRowNumbers.push(sourceRowNumber);
      } else {
        normalizedRows.push(normalized);
      }
    }

    const sourceChecksum = await computeSourceChecksum(normalizedRows);
    const rootCandidateIds = normalizedRows
      .filter((row) => row.parentId === null && row.id !== null)
      .map((row) => row.id as string);

    const preview: ImportPreview = {
      sheetName,
      headerRowNumber: detection.rowIndex + 1,
      mappedColumns: detection.mappedColumns,
      normalizedRows,
      ignoredRowNumbers,
      rootCandidateIds,
      issues: errors,
      sourceChecksum,
    };
    return stageSuccess(preview);
  }
}
