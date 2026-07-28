import Ajv2020 from "ajv/dist/2020.js";
import configurationSchema from "../../../schemas/engine-configuration.schema.json";
import type { EngineConfiguration } from "./types.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validate = ajv.compile(configurationSchema);

export interface ConfigurationValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ConfigurationValidationError[];
}

export interface ConfigurationValidationError {
  readonly instancePath: string;
  readonly keyword: string;
  readonly message: string;
}

export const validateEngineConfiguration = (
  input: unknown,
): ConfigurationValidationResult => {
  const valid = validate(input);
  const errors: ConfigurationValidationError[] = valid
    ? []
    : (validate.errors ?? []).map((error) => ({
        instancePath: error.instancePath,
        keyword: error.keyword,
        message: error.message ?? "invalid configuration",
  }));
  if (valid) {
    const configuration = input as unknown as EngineConfiguration;
    if (configuration.demand.maximumDemand < configuration.demand.minimumDemand) {
      errors.push({
        instancePath: "/demand/maximumDemand",
        keyword: "range",
        message: "must be greater than or equal to minimumDemand",
      });
    }
    if (configuration.demand.maximumArea < configuration.demand.minimumArea) {
      errors.push({
        instancePath: "/demand/maximumArea",
        keyword: "range",
        message: "must be greater than or equal to minimumArea",
      });
    }
    if (
      configuration.territory.minimumTerritoryArea <
      configuration.demand.minimumArea
    ) {
      errors.push({
        instancePath: "/territory/minimumTerritoryArea",
        keyword: "range",
        message: "must be greater than or equal to demand.minimumArea",
      });
    }
    if (
      configuration.territory.rootEntryWidth <=
      configuration.territory.minimumCorridorWidth
    ) {
      errors.push({
        instancePath: "/territory/rootEntryWidth",
        keyword: "range",
        message: "must be greater than minimumCorridorWidth",
      });
    }
  }
  return {
    valid: errors.length === 0,
    errors,
  };
};

export const assertEngineConfiguration = (
  input: unknown,
): asserts input is EngineConfiguration => {
  const result = validateEngineConfiguration(input);
  if (!result.valid) {
    throw new TypeError(`Invalid EngineConfiguration: ${JSON.stringify(result.errors)}`);
  }
};
