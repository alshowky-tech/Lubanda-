import fs from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

describe("Milestone 1 diagnostic SVG", () => {
  it("is valid XML and contains every required diagnostic", async () => {
    const svg = await fs.readFile(
      "artifacts/milestone-1-geometry-diagnostics.svg",
      "utf8",
    );
    expect(() =>
      new XMLParser({ ignoreAttributes: false }).parse(svg),
    ).not.toThrow();
    expect(svg).toContain("Proper intersection: PROPER");
    expect(svg).toContain("Non-intersection: NONE");
    expect(svg).toContain("Endpoint touching: ENDPOINT_TOUCH");
    expect(svg).toContain("Collinear overlap: COLLINEAR_OVERLAP");
    expect(svg).toContain("Adaptive Bézier sampling");
    expect(svg).toContain("SpatialHash query");
    expect(svg).toContain("Dashed rectangle = query bounds");
  });
});
