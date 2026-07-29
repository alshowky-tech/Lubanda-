import type { EngineConfiguration } from "../config/types.js";
import { formatDisplayName } from "../display-names/index.js";

export interface LabelTextMetrics {
  readonly displayName: string;
  readonly width: number;
  readonly height: number;
}

export const measureLabelText = (
  originalName: string,
  configuration: EngineConfiguration,
): LabelTextMetrics => {
  const displayName = formatDisplayName(
    originalName,
    configuration.displayNames,
  );
  const fontSize = configuration.labels.minimumFontSize;
  return {
    displayName,
    width: Math.max(
      fontSize * 2,
      [...displayName].length * configuration.demand.estimatedCharacterWidth +
        configuration.demand.personPadding * 2,
    ),
    height: Math.max(
      fontSize,
      configuration.demand.estimatedLabelHeight +
        configuration.demand.personPadding * 2,
    ),
  };
};
