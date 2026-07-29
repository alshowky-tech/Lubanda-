import type { ImportPreview } from "../../src/core/import/types.js";
import type {
  GenealogySnapshot,
  NormalizedPersonRow,
} from "../../src/core/genealogy/types.js";
import { computeSourceChecksum } from "../../src/core/genealogy/checksum.js";
import {
  asPersonId,
  asProjectId,
  asRevisionId,
} from "../../src/core/contracts/identifiers.js";

export const row = (
  id: string | null,
  name: string | null,
  parentId: string | null,
  generation: number | null,
  sourceRowNumber: number,
  explicitDisplayOrder: number | null = null,
): NormalizedPersonRow => ({
  id,
  name,
  parentId,
  generation,
  explicitDisplayOrder,
  sourceRowNumber,
  title: null,
  branchName: null,
  birthPlace: null,
  birthYear: null,
  deathYear: null,
  notes: null,
  sourceRef: null,
  aliases: [],
  original: { id, name, parentId, generation },
});

export const preview = async (
  rows: readonly NormalizedPersonRow[],
): Promise<ImportPreview> => ({
  sheetName: "Genealogy",
  headerRowNumber: 1,
  mappedColumns: [],
  normalizedRows: rows,
  ignoredRowNumbers: [],
  rootCandidateIds: rows
    .filter((item) => item.id !== null && item.parentId === null)
    .map((item) => item.id as string),
  issues: [],
  sourceChecksum: await computeSourceChecksum(rows),
});

export const acceptedSnapshot = (): GenealogySnapshot => ({
  schemaVersion: "1.0",
  projectId: asProjectId("project"),
  revisionId: asRevisionId("revision"),
  persons: [
    {
      id: asPersonId("1"),
      name: "محمد",
      parentId: null,
      generation: 1,
      sourceRowNumber: 2,
      explicitDisplayOrder: null,
    },
    {
      id: asPersonId("2"),
      name: "مهدي",
      parentId: asPersonId("1"),
      generation: 2,
      sourceRowNumber: 3,
      explicitDisplayOrder: 2,
    },
    {
      id: asPersonId("3"),
      name: "حيدر",
      parentId: asPersonId("1"),
      generation: 2,
      sourceRowNumber: 4,
      explicitDisplayOrder: 1,
    },
    {
      id: asPersonId("4"),
      name: "راضي",
      parentId: asPersonId("2"),
      generation: 3,
      sourceRowNumber: 5,
      explicitDisplayOrder: null,
    },
  ],
  sourceChecksum: "a".repeat(64),
  createdAt: "2026-07-27T00:00:00.000Z",
  validationVersion: "1.0",
});

export interface SyntheticTreeOptions {
  readonly size: number;
  readonly shape?: "LINEAR" | "BALANCED" | "STAR" | "UNBALANCED";
  readonly extraRootSize?: number;
  readonly reverseRows?: boolean;
}

export const syntheticSnapshot = (
  options: SyntheticTreeOptions,
): GenealogySnapshot => {
  const shape = options.shape ?? "BALANCED";
  const persons: GenealogySnapshot["persons"][number][] = [];
  const generations: number[] = [];
  for (let index = 0; index < options.size; index += 1) {
    const id = `${index + 1}`;
    let parentIndex: number | null;
    if (index === 0) parentIndex = null;
    else if (shape === "LINEAR") parentIndex = index - 1;
    else if (shape === "STAR") parentIndex = 0;
    else if (shape === "UNBALANCED") {
      parentIndex = index < Math.ceil(options.size * 0.75)
        ? index - 1
        : 0;
    } else {
      parentIndex = Math.floor((index - 1) / 2);
    }
    const generation =
      parentIndex === null ? 1 : (generations[parentIndex] as number) + 1;
    generations.push(generation);
    persons.push({
      id: asPersonId(id),
      name: `Person ${id}`,
      parentId:
        parentIndex === null ? null : asPersonId(`${parentIndex + 1}`),
      generation,
      sourceRowNumber: index + 2,
      explicitDisplayOrder: index % 5 === 0 ? index : null,
    });
  }
  const extraRootSize = options.extraRootSize ?? 0;
  for (let index = 0; index < extraRootSize; index += 1) {
    const id = `x-${index + 1}`;
    persons.push({
      id: asPersonId(id),
      name: `Outside ${index + 1}`,
      parentId: index === 0 ? null : asPersonId(`x-${index}`),
      generation: index + 1,
      sourceRowNumber: options.size + index + 2,
      explicitDisplayOrder: null,
    });
  }
  const ordered = options.reverseRows ? [...persons].reverse() : persons;
  return {
    schemaVersion: "1.0",
    projectId: asProjectId("synthetic-project"),
    revisionId: asRevisionId("synthetic-revision"),
    persons: Object.freeze(ordered),
    sourceChecksum: "b".repeat(64),
    createdAt: "2026-07-28T00:00:00.000Z",
    validationVersion: "1.0",
  };
};
