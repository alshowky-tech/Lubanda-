import type { DiagnosticEvent } from "./diagnostics.js";
import type { EngineIssue } from "./issues.js";

export type StageResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly diagnostics: readonly DiagnosticEvent[];
    }
  | {
      readonly ok: false;
      readonly errors: readonly EngineIssue[];
      readonly diagnostics: readonly DiagnosticEvent[];
    };

export const stageSuccess = <T>(
  value: T,
  diagnostics: readonly DiagnosticEvent[] = [],
): StageResult<T> => ({ ok: true, value, diagnostics });

export const stageFailure = <T = never>(
  errors: readonly EngineIssue[],
  diagnostics: readonly DiagnosticEvent[] = [],
): StageResult<T> => ({ ok: false, errors, diagnostics });

