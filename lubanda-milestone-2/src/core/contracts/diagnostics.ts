import type { CoreStage } from "./solve-stage.js";

export interface DiagnosticEvent {
  readonly timestamp: number;
  readonly operationId: string;
  readonly stage: CoreStage;
  readonly eventType: string;
  readonly entityId?: string;
  readonly durationMs?: number;
  readonly metrics?: Readonly<Record<string, number>>;
  readonly payload?: Readonly<Record<string, unknown>>;
}
