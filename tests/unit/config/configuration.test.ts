import {
  DEFAULT_ENGINE_CONFIGURATION,
  validateEngineConfiguration,
} from "../../../src/core/config/index.js";

describe("EngineConfiguration", () => {
  it("accepts defaults", () => {
    expect(validateEngineConfiguration(DEFAULT_ENGINE_CONFIGURATION)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("rejects invalid geometry and demand values", () => {
    expect(
      validateEngineConfiguration({
        ...DEFAULT_ENGINE_CONFIGURATION,
        geometry: { ...DEFAULT_ENGINE_CONFIGURATION.geometry, epsilon: 0 },
      }).valid,
    ).toBe(false);
    expect(
      validateEngineConfiguration({
        ...DEFAULT_ENGINE_CONFIGURATION,
        demand: {
          ...DEFAULT_ENGINE_CONFIGURATION.demand,
          subtreeSizeWeight: -1,
        },
      }).valid,
    ).toBe(false);
    expect(
      validateEngineConfiguration({
        ...DEFAULT_ENGINE_CONFIGURATION,
        demand: {
          ...DEFAULT_ENGINE_CONFIGURATION.demand,
          minimumDemand: 10,
          maximumDemand: 1,
        },
      }).valid,
    ).toBe(false);
  });
});
