import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import { measureLabelText } from "../../../src/core/labels/LabelTextMetrics.js";

describe("measureLabelText", () => {
  it("uses the formatted display name for label width", () => {
    const formatted = measureLabelText(
      "السيد محمد الغريب",
      DEFAULT_ENGINE_CONFIGURATION,
    );
    const unformatted = measureLabelText("السيد محمد الغريب", {
      ...DEFAULT_ENGINE_CONFIGURATION,
      displayNames: {
        ...DEFAULT_ENGINE_CONFIGURATION.displayNames,
        removeHonorificPrefixes: false,
      },
    });

    expect(formatted.displayName).toBe("محمد الغريب");
    expect(formatted.width).toBeLessThan(unformatted.width);
    expect(formatted.height).toBe(unformatted.height);
  });

  it("does not alter ordinary names or the input string", () => {
    const originalName = "محمد  الغريب ";
    const measured = measureLabelText(
      originalName,
      DEFAULT_ENGINE_CONFIGURATION,
    );

    expect(measured.displayName).toBe(originalName);
    expect(originalName).toBe("محمد  الغريب ");
  });
});
