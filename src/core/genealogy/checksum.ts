import { compareCanonicalPersons } from "./canonical-order.js";
import type { NormalizedPersonRow } from "./types.js";

const canonicalObject = (row: NormalizedPersonRow): Readonly<Record<string, unknown>> => ({
  aliases: [...row.aliases],
  birthPlace: row.birthPlace,
  birthYear: row.birthYear,
  branchName: row.branchName,
  deathYear: row.deathYear,
  explicitDisplayOrder: row.explicitDisplayOrder,
  generation: row.generation,
  id: row.id,
  name: row.name,
  notes: row.notes,
  parentId: row.parentId,
  sourceRef: row.sourceRef,
  sourceRowNumber: row.sourceRowNumber,
  title: row.title,
});

export const canonicalizeNormalizedRows = (
  rows: readonly NormalizedPersonRow[],
): string =>
  JSON.stringify(
    [...rows].sort(compareCanonicalPersons).map((row) => canonicalObject(row)),
  );

export const computeSourceChecksum = async (
  rows: readonly NormalizedPersonRow[],
): Promise<string> => {
  const bytes = new TextEncoder().encode(canonicalizeNormalizedRows(rows));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
};

