import type { SkeletonBranchId } from "../contracts/identifiers.js";
import type {
  RoutingDiagnostic,
  RoutingDiagnosticStage,
  RoutingDiagnosticSeverity,
} from "./types.js";

/**
 * Deterministic diagnostic collector for the routing subsystem.
 */
export class RoutingDiagnosticCollector {
  readonly #diagnostics: RoutingDiagnostic[] = [];
  #sequence = 0;

  add(
    stage: RoutingDiagnosticStage,
    code: string,
    severity: RoutingDiagnosticSeverity,
    message: string,
    branchId?: SkeletonBranchId,
    metrics?: Readonly<Record<string, number>>,
    relatedBranchIds?: readonly SkeletonBranchId[],
  ): void {
    this.#diagnostics.push(
      Object.freeze({
        sequence: this.#sequence,
        branchId,
        stage,
        code,
        severity,
        message,
        ...(metrics === undefined ? {} : { metrics }),
        ...(relatedBranchIds === undefined ? {} : { relatedBranchIds }),
      }) as RoutingDiagnostic,
    );
    this.#sequence += 1;
  }

  snapshot(): readonly RoutingDiagnostic[] {
    return Object.freeze([...this.#diagnostics]);
  }
}
