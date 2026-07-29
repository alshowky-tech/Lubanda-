import type { EngineIssue, StageResult } from "../contracts/index.js";
import type { NormalizedPersonRow } from "../genealogy/types.js";

export type CanonicalColumn =
  | "id"
  | "name"
  | "parentId"
  | "generation"
  | "title"
  | "branchName"
  | "birthPlace"
  | "birthYear"
  | "deathYear"
  | "notes"
  | "sourceRef"
  | "explicitDisplayOrder"
  | "aliases";

export interface MappedColumn {
  readonly field: CanonicalColumn;
  readonly columnIndex: number;
  readonly sourceHeader: string;
}

export interface ImportOptions {
  readonly sheetName?: string;
  readonly headerSearchRows?: number;
  readonly limits?: Partial<WorkbookLimits>;
}

export interface WorkbookLimits {
  readonly maxFileBytes: number;
  readonly maxUncompressedBytes: number;
  readonly maxSheets: number;
  readonly maxRows: number;
  readonly maxColumns: number;
}

export interface ImportPreview {
  readonly sheetName: string;
  readonly headerRowNumber: number;
  readonly mappedColumns: readonly MappedColumn[];
  readonly normalizedRows: readonly NormalizedPersonRow[];
  readonly ignoredRowNumbers: readonly number[];
  readonly rootCandidateIds: readonly string[];
  readonly issues: readonly EngineIssue[];
  readonly sourceChecksum: string;
}

export interface GenealogyImporter {
  importWorkbook(
    input: ArrayBuffer,
    options?: ImportOptions,
  ): Promise<StageResult<ImportPreview>>;
}

