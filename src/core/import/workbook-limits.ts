import type { WorkbookLimits } from "./types.js";

export const DEFAULT_WORKBOOK_LIMITS: WorkbookLimits = Object.freeze({
  maxFileBytes: 25 * 1024 * 1024,
  maxUncompressedBytes: 100 * 1024 * 1024,
  maxSheets: 20,
  maxRows: 5_000,
  maxColumns: 64,
});

