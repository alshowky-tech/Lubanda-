import { DEFAULT_ENGINE_CONFIGURATION } from "../../../src/core/config/index.js";
import {
  DisplayNameFormatter,
  formatDisplayName,
} from "../../../src/core/display-names/index.js";

const configuration = DEFAULT_ENGINE_CONFIGURATION.displayNames;

describe("DisplayNameFormatter", () => {
  it.each([
    ["السيد محمد الغريب", "محمد الغريب"],
    ["الشيخ علي", "علي"],
    ["الحاج حسن الموسوي", "حسن الموسوي"],
    ["محمد الغريب", "محمد الغريب"],
  ])("formats %s without changing the remainder", (name, expected) => {
    expect(formatDisplayName(name, configuration)).toBe(expected);
  });

  it("removes repeated leading honorifics", () => {
    expect(formatDisplayName(
      "السيد   الشيخ\tمحمد  الغريب ",
      configuration,
    )).toBe("محمد  الغريب ");
  });

  it("ignores repeated whitespace within a configured prefix", () => {
    expect(new DisplayNameFormatter().format(
      "صاحب   السمو  محمد",
      {
        removeHonorificPrefixes: true,
        honorificPrefixes: ["صاحب السمو"],
      },
    )).toBe("محمد");
  });

  it("removes the longest matching prefix first", () => {
    expect(formatDisplayName(
      "السيد الأكبر محمد",
      {
        removeHonorificPrefixes: true,
        honorificPrefixes: ["السيد", "السيد الأكبر"],
      },
    )).toBe("محمد");
  });

  it("does not remove embedded or partial matches", () => {
    expect(formatDisplayName("محمد السيد علي", configuration))
      .toBe("محمد السيد علي");
    expect(formatDisplayName("السيدمحمد", configuration)).toBe("السيدمحمد");
  });

  it("returns the original name exactly when formatting is disabled", () => {
    const name = "  السيد   محمد  ";
    expect(formatDisplayName(name, {
      ...configuration,
      removeHonorificPrefixes: false,
    })).toBe(name);
  });

  it("keeps an honorific-only name instead of producing a blank label", () => {
    expect(formatDisplayName("السيد", configuration)).toBe("السيد");
    expect(formatDisplayName("  الشيخ  ", configuration)).toBe("  الشيخ  ");
  });

  it("is deterministic and does not mutate configuration", () => {
    const prefixes = ["الشيخ", "السيد"];
    const custom = {
      removeHonorificPrefixes: true,
      honorificPrefixes: prefixes,
    };
    const formatter = new DisplayNameFormatter();
    const first = formatter.format("الشيخ السيد علي", custom);
    const second = formatter.format("الشيخ السيد علي", custom);
    expect(second).toBe(first);
    expect(prefixes).toEqual(["الشيخ", "السيد"]);
  });
});
