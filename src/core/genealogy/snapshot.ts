import { isBlockingIssue } from "../contracts/issues.js";
import type { ValidationReport } from "../validation/validator.js";
import type { GenealogySnapshot, SnapshotBuildInput } from "./types.js";

export const buildAcceptedGenealogySnapshot = (
  validation: ValidationReport,
  input: SnapshotBuildInput,
): GenealogySnapshot => {
  if (
    !validation.accepted ||
    validation.issues.some((candidate) => isBlockingIssue(candidate))
  ) {
    throw new TypeError(
      "A GenealogySnapshot cannot be created while blocking validation issues exist",
    );
  }
  const createdAt = new Date(input.createdAt);
  if (Number.isNaN(createdAt.valueOf()) || createdAt.toISOString() !== input.createdAt) {
    throw new TypeError("createdAt must be a canonical ISO-8601 timestamp");
  }
  return {
    schemaVersion: "1.0",
    projectId: input.projectId,
    revisionId: input.revisionId,
    persons: validation.genealogy.persons,
    sourceChecksum: validation.genealogy.sourceChecksum,
    createdAt: input.createdAt,
    validationVersion: "1.0",
  };
};
