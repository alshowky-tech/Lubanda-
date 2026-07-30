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

/**
 * Parse a single CSV line into fields, handling quoted fields.
 * This is a minimal RFC-4180 parser — handles double-quoted fields
 * with embedded commas, newlines are not expected in fields.
 */
const parseCsvLine = (line: string): string[] => {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
};

/**
 * A minimal CSV genealogy importer that reads the same column-mapped
 * format as the XLSX importer but from a UTF-8 CSV file.
 *
 * This adapter does NOT replace or weaken the existing XlsxGenealogyImporter.
 * It is an additional input path that produces compatible ImportPreview output.
 *
 * The CSV must use:
 * - UTF-8 encoding (BOM optional)
 * - Comma delimiter
 * - Mandatory header with columns matching the XLSX column aliases
 *
 * Deterministic behavior is preserved because the header detection
 * and row normalization code is shared with the XLSX path.
 */
export class CsvGenealogyImporter implements GenealogyImporter {
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

    // Decode UTF-8 CSV text
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text: string;
    try {
      text = decoder.decode(new Uint8Array(input));
    } catch {
      return stageFailure([
        issue("MALFORMED_VALUE", "FATAL", "import.workbookParseFailed", {
          details: { reason: "CSV file is not valid UTF-8" },
          recoverable: false,
        }),
      ]);
    }

    const lines = text.split(/\r?\n/);
    const rows: string[][] = [];
    for (const line of lines) {
      if (line.trim().length === 0) continue; // skip empty lines
      rows.push(parseCsvLine(line));
    }

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
        issue("MISSING_COLUMN", "FATAL", "import.missingRequiredColumn", { field }),
      );
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
      sheetName: "CSV",
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
