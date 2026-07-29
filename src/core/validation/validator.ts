import {
  asPersonId,
  isBlockingIssue,
  type EngineIssue,
} from "../contracts/index.js";
import { compareCanonicalPersons } from "../genealogy/canonical-order.js";
import type {
  AcceptedGenealogy,
  NormalizedPersonRow,
  Person,
} from "../genealogy/types.js";
import type { ImportPreview } from "../import/types.js";
import { detectCyclePaths } from "./cycle-detection.js";
import {
  DEFAULT_VALIDATION_POLICY,
  type ValidationPolicy,
} from "./policy.js";

export interface GenealogyStatistics {
  readonly rowCount: number;
  readonly acceptedPersonCount: number;
  readonly rootCount: number;
  readonly maximumGeneration: number | null;
}

interface ValidationReportBase {
  readonly issues: readonly EngineIssue[];
  readonly errors: readonly EngineIssue[];
  readonly warnings: readonly EngineIssue[];
  readonly statistics: GenealogyStatistics;
}

export type ValidationReport =
  | (ValidationReportBase & { readonly accepted: false })
  | (ValidationReportBase & {
      readonly accepted: true;
      readonly genealogy: AcceptedGenealogy;
    });

const issue = (
  code: EngineIssue["code"],
  severity: EngineIssue["severity"],
  messageKey: string,
  additional: Partial<EngineIssue> = {},
): EngineIssue => ({
  code,
  severity,
  messageKey,
  stage: "VALIDATE",
  recoverable: true,
  ...additional,
});

const optionalText = <K extends keyof Person>(
  target: Record<string, unknown>,
  key: K,
  value: string | null,
): void => {
  if (value !== null) target[key as string] = value;
};

const toPerson = (row: NormalizedPersonRow): Person => {
  if (row.id === null || row.name === null || row.generation === null) {
    throw new TypeError("Cannot create Person from an invalid normalized row");
  }
  const person: Record<string, unknown> = {
    id: asPersonId(row.id),
    name: row.name,
    parentId: row.parentId === null ? null : asPersonId(row.parentId),
    generation: row.generation,
    sourceRowNumber: row.sourceRowNumber,
    explicitDisplayOrder: row.explicitDisplayOrder,
    source: { original: row.original },
  };
  optionalText(person, "title", row.title);
  optionalText(person, "branchName", row.branchName);
  optionalText(person, "birthPlace", row.birthPlace);
  optionalText(person, "birthYear", row.birthYear);
  optionalText(person, "deathYear", row.deathYear);
  optionalText(person, "notes", row.notes);
  if (row.aliases.length > 0) person.aliases = [...row.aliases];
  if (row.sourceRef !== null) person.metadata = { sourceRef: row.sourceRef };
  return person as unknown as Person;
};

export class GenealogyValidator {
  validate(
    preview: ImportPreview,
    policy: ValidationPolicy = DEFAULT_VALIDATION_POLICY,
  ): ValidationReport {
    const issues: EngineIssue[] = [...preview.issues];
    if (preview.normalizedRows.length === 0) {
      issues.push(
        issue("EMPTY_FILE", "ERROR", "validation.noDataRows", {
          recoverable: true,
        }),
      );
    }
    if (!Number.isSafeInteger(policy.rootGenerationBaseline)) {
      issues.push(
        issue("MALFORMED_VALUE", "FATAL", "validation.invalidGenerationBaseline", {
          field: "rootGenerationBaseline",
          recoverable: false,
        }),
      );
    }

    const rowsById = new Map<string, NormalizedPersonRow[]>();
    for (const row of preview.normalizedRows) {
      if (row.id === null) {
        issues.push(
          issue("EMPTY_ID", "ERROR", "validation.emptyId", {
            rowNumber: row.sourceRowNumber,
            field: "id",
          }),
        );
      } else {
        const existing = rowsById.get(row.id) ?? [];
        existing.push(row);
        rowsById.set(row.id, existing);
      }
      if (row.name === null) {
        issues.push(
          issue("EMPTY_NAME", "ERROR", "validation.emptyName", {
            rowNumber: row.sourceRowNumber,
            field: "name",
            ...(row.id === null ? {} : { entityIds: [row.id] }),
          }),
        );
      }
      if (row.generation === null) {
        issues.push(
          issue("MALFORMED_VALUE", "ERROR", "validation.invalidGeneration", {
            rowNumber: row.sourceRowNumber,
            field: "generation",
            ...(row.id === null ? {} : { entityIds: [row.id] }),
          }),
        );
      }
    }

    for (const [id, rows] of rowsById) {
      if (rows.length > 1) {
        issues.push(
          issue("DUPLICATE_ID", "ERROR", "validation.duplicateId", {
            entityIds: [id],
            details: { rowNumbers: rows.map((row) => row.sourceRowNumber) },
          }),
        );
      }
    }

    const uniqueRows = [...rowsById.values()]
      .filter((rows) => rows.length === 1)
      .map((rows) => rows[0] as NormalizedPersonRow);
    const uniqueIds = new Set(uniqueRows.map((row) => row.id as string));

    for (const row of uniqueRows) {
      const id = row.id as string;
      if (row.parentId === id) {
        issues.push(
          issue("SELF_PARENT", "ERROR", "validation.selfParent", {
            rowNumber: row.sourceRowNumber,
            entityIds: [id],
            field: "parentId",
          }),
        );
      } else if (row.parentId !== null && !uniqueIds.has(row.parentId)) {
        issues.push(
          issue("MISSING_PARENT", "ERROR", "validation.missingParent", {
            rowNumber: row.sourceRowNumber,
            entityIds: [id, row.parentId],
            field: "parentId",
          }),
        );
      }
    }

    const roots = uniqueRows.filter((row) => row.parentId === null && row.id !== null);
    if (roots.length === 0 && preview.normalizedRows.length > 0) {
      issues.push(issue("NO_ROOT", "ERROR", "validation.noRoot"));
    } else if (roots.length > 1) {
      issues.push(
        issue("MULTIPLE_ROOTS", policy.multipleRootsSeverity, "validation.multipleRoots", {
          entityIds: roots.map((row) => row.id as string),
        }),
      );
    }

    const cycleRows = uniqueRows
      .filter((row) => row.id !== null)
      .map((row) => ({ id: row.id as string, parentId: row.parentId }));
    for (const cyclePath of detectCyclePaths(cycleRows)) {
      issues.push(
        issue("CYCLE", "ERROR", "validation.cycle", {
          entityIds: cyclePath,
          details: { cyclePath },
        }),
      );
    }

    const uniqueById = new Map(
      uniqueRows.map((row) => [row.id as string, row] as const),
    );
    for (const row of uniqueRows) {
      if (row.id === null || row.generation === null) continue;
      if (row.parentId === null) {
        if (row.generation !== policy.rootGenerationBaseline) {
          issues.push(
            issue(
              "GENERATION_MISMATCH",
              "ERROR",
              "validation.rootGenerationMismatch",
              {
                rowNumber: row.sourceRowNumber,
                entityIds: [row.id],
                field: "generation",
                details: {
                  expected: policy.rootGenerationBaseline,
                  actual: row.generation,
                },
              },
            ),
          );
        }
      } else {
        const parent = uniqueById.get(row.parentId);
        if (
          parent?.generation !== null &&
          parent?.generation !== undefined &&
          row.generation !== parent.generation + 1
        ) {
          issues.push(
            issue("GENERATION_MISMATCH", "ERROR", "validation.childGenerationMismatch", {
              rowNumber: row.sourceRowNumber,
              entityIds: [row.id, row.parentId],
              field: "generation",
              details: { expected: parent.generation + 1, actual: row.generation },
            }),
          );
        }
      }
    }

    const errors = issues.filter(isBlockingIssue);
    const warnings = issues.filter(
      (entry) => entry.severity === "WARNING" || entry.severity === "INFO",
    );
    const validRows = uniqueRows.filter(
      (row) => row.id !== null && row.name !== null && row.generation !== null,
    );
    const statistics: GenealogyStatistics = {
      rowCount: preview.normalizedRows.length,
      acceptedPersonCount: errors.length === 0 ? validRows.length : 0,
      rootCount: roots.length,
      maximumGeneration:
        validRows.length === 0
          ? null
          : Math.max(...validRows.map((row) => row.generation as number)),
    };

    if (errors.length > 0) {
      return { accepted: false, issues, errors, warnings, statistics };
    }

    const persons = validRows.map(toPerson).sort(compareCanonicalPersons);
    const acceptedRoots = persons
      .filter((person) => person.parentId === null)
      .map((person) => person.id);
    return {
      accepted: true,
      issues,
      errors,
      warnings,
      statistics: { ...statistics, acceptedPersonCount: persons.length },
      genealogy: {
        persons,
        roots: acceptedRoots,
        sourceChecksum: preview.sourceChecksum,
      },
    };
  }
}
