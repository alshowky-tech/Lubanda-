import type { CanonicalColumn, MappedColumn } from "../import/types.js";
import { parseOptionalFiniteNumber, parseStrictInteger } from "./numerals.js";
import type { NormalizedPersonRow, SourceScalar } from "./types.js";

export const normalizeCanonicalText = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).normalize("NFC").trim();
  return normalized.length === 0 ? null : normalized;
};

export const normalizeId = (value: unknown): string | null =>
  normalizeCanonicalText(value);

export const normalizeSearchText = (value: string): string =>
  value
    .normalize("NFC")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/gu, "")
    .replace(/\u0640/gu, "")
    .replace(/[أإآٱ]/gu, "ا")
    .replace(/[ى]/gu, "ي")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("ar");

const asSourceScalar = (value: unknown): SourceScalar => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
};

const splitAliases = (value: unknown): readonly string[] => {
  const normalized = normalizeCanonicalText(value);
  if (!normalized) return [];
  return normalized
    .split(/[،,;؛]/u)
    .map((part) => part.normalize("NFC").trim())
    .filter((part) => part.length > 0);
};

export const normalizePersonRow = (
  row: readonly unknown[],
  sourceRowNumber: number,
  mappedColumns: readonly MappedColumn[],
): NormalizedPersonRow => {
  const values = new Map<CanonicalColumn, unknown>();
  const original: Record<string, SourceScalar> = {};
  for (const mapping of mappedColumns) {
    const value = row[mapping.columnIndex] ?? null;
    values.set(mapping.field, value);
    original[mapping.field] = asSourceScalar(value);
  }

  return {
    id: normalizeId(values.get("id")),
    name: normalizeCanonicalText(values.get("name")),
    parentId: normalizeId(values.get("parentId")),
    generation: parseStrictInteger(values.get("generation")),
    explicitDisplayOrder: parseOptionalFiniteNumber(values.get("explicitDisplayOrder")),
    sourceRowNumber,
    title: normalizeCanonicalText(values.get("title")),
    branchName: normalizeCanonicalText(values.get("branchName")),
    birthPlace: normalizeCanonicalText(values.get("birthPlace")),
    birthYear: normalizeCanonicalText(values.get("birthYear")),
    deathYear: normalizeCanonicalText(values.get("deathYear")),
    notes: normalizeCanonicalText(values.get("notes")),
    sourceRef: normalizeCanonicalText(values.get("sourceRef")),
    aliases: splitAliases(values.get("aliases")),
    original,
  };
};

export const isBlankNormalizedRow = (row: NormalizedPersonRow): boolean =>
  row.id === null &&
  row.name === null &&
  row.parentId === null &&
  row.generation === null &&
  Object.values(row.original).every(
    (value) => value === null || String(value).trim().length === 0,
  );

