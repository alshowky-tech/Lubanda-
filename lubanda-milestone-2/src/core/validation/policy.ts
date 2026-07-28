import type { IssueSeverity } from "../contracts/issues.js";

export interface ValidationPolicy {
  readonly version: "1.0";
  readonly rootGenerationBaseline: number;
  readonly multipleRootsSeverity: IssueSeverity;
}

export const DEFAULT_VALIDATION_POLICY: ValidationPolicy = Object.freeze({
  version: "1.0",
  rootGenerationBaseline: 1,
  multipleRootsSeverity: "WARNING",
});

