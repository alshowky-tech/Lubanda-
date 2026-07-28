import { REQUIRED_COLUMNS, resolveHeader } from "./header-aliases.js";
import type { CanonicalColumn, MappedColumn } from "./types.js";

export interface HeaderDetection {
  readonly rowIndex: number;
  readonly mappedColumns: readonly MappedColumn[];
  readonly missingRequired: readonly CanonicalColumn[];
  readonly score: number;
}

export const detectHeader = (
  rows: readonly (readonly unknown[])[],
  searchRows: number,
): HeaderDetection | null => {
  let best: HeaderDetection | null = null;
  const limit = Math.min(rows.length, Math.max(1, searchRows));

  for (let rowIndex = 0; rowIndex < limit; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const seen = new Set<CanonicalColumn>();
    const mappedColumns: MappedColumn[] = [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      const field = resolveHeader(row[columnIndex]);
      if (!field || seen.has(field)) continue;
      seen.add(field);
      mappedColumns.push({
        field,
        columnIndex,
        sourceHeader: String(row[columnIndex] ?? ""),
      });
    }
    const missingRequired = REQUIRED_COLUMNS.filter((field) => !seen.has(field));
    const requiredHits = REQUIRED_COLUMNS.length - missingRequired.length;
    const score = requiredHits * 100 + mappedColumns.length;
    const candidate = { rowIndex, mappedColumns, missingRequired, score };
    if (
      best === null ||
      candidate.score > best.score ||
      (candidate.score === best.score && candidate.rowIndex < best.rowIndex)
    ) {
      best = candidate;
    }
  }

  return best;
};

