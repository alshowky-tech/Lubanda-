import type { DiagnosticEvent } from "../contracts/diagnostics.js";
import type { CoreStage } from "../contracts/solve-stage.js";

export interface DiagnosticInput {
  readonly stage: CoreStage;
  readonly eventType: string;
  readonly entityId?: string;
  readonly metrics?: Readonly<Record<string, number>>;
  readonly payload?: Readonly<Record<string, unknown>>;
}

export class DiagnosticCollector {
  readonly #operationId: string;
  readonly #events: DiagnosticEvent[] = [];
  #sequence = 0;

  constructor(operationId: string) {
    if (operationId.trim().length === 0) {
      throw new TypeError("operationId must be non-empty");
    }
    this.#operationId = operationId;
  }

  emit(input: DiagnosticInput): void {
    this.#events.push(
      Object.freeze({
        timestamp: this.#sequence,
        operationId: this.#operationId,
        stage: input.stage,
        eventType: input.eventType,
        ...(input.entityId === undefined ? {} : { entityId: input.entityId }),
        ...(input.metrics === undefined ? {} : { metrics: input.metrics }),
        ...(input.payload === undefined ? {} : { payload: input.payload }),
      }),
    );
    this.#sequence += 1;
  }

  snapshot(): readonly DiagnosticEvent[] {
    return Object.freeze([...this.#events]);
  }
}

