import fs from "node:fs/promises";
import path from "node:path";
import {
  intersectSegments,
  sampleCubicBezier,
  type CubicBezier,
  type Vec2,
} from "../src/core/geometry/index.js";
import { SpatialHash } from "../src/core/spatial/SpatialHash.js";

const outputPath = path.resolve("artifacts/milestone-1-geometry-diagnostics.svg");

const line = (a: Vec2, b: Vec2, color: string): string =>
  `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="${color}" stroke-width="4" stroke-linecap="round"/>`;

const label = (x: number, y: number, text: string): string =>
  `<text x="${x}" y="${y}" font-family="system-ui, sans-serif" font-size="16" fill="#17324d">${text}</text>`;

const examples = [
  {
    title: "Proper intersection",
    offset: { x: 40, y: 70 },
    a: { x: 0, y: 0 },
    b: { x: 120, y: 80 },
    c: { x: 0, y: 80 },
    d: { x: 120, y: 0 },
  },
  {
    title: "Non-intersection",
    offset: { x: 220, y: 70 },
    a: { x: 0, y: 10 },
    b: { x: 120, y: 10 },
    c: { x: 0, y: 70 },
    d: { x: 120, y: 70 },
  },
  {
    title: "Endpoint touching",
    offset: { x: 400, y: 70 },
    a: { x: 0, y: 20 },
    b: { x: 60, y: 50 },
    c: { x: 60, y: 50 },
    d: { x: 120, y: 10 },
  },
  {
    title: "Collinear overlap",
    offset: { x: 580, y: 70 },
    a: { x: 0, y: 45 },
    b: { x: 90, y: 45 },
    c: { x: 45, y: 45 },
    d: { x: 125, y: 45 },
  },
] as const;

const panels = examples.map((example) => {
  const move = (point: Vec2): Vec2 => ({
    x: point.x + example.offset.x,
    y: point.y + example.offset.y,
  });
  const result = intersectSegments(example.a, example.b, example.c, example.d);
  return [
    `<g>`,
    label(example.offset.x, example.offset.y - 22, `${example.title}: ${result.kind}`),
    line(move(example.a), move(example.b), "#0f766e"),
    line(move(example.c), move(example.d), "#dc6b35"),
    `</g>`,
  ].join("");
});

const curve: CubicBezier = {
  p0: { x: 60, y: 330 },
  p1: { x: 190, y: 170 },
  p2: { x: 350, y: 420 },
  p3: { x: 500, y: 250 },
};
const samples = sampleCubicBezier(curve, {
  tolerance: 1,
  maxSubdivisionDepth: 16,
});
const samplePath = samples.map((point) => `${point.x},${point.y}`).join(" ");
const sampleDots = samples
  .map(
    (point) =>
      `<circle cx="${point.x}" cy="${point.y}" r="3" fill="#7c3aed"/>`,
  )
  .join("");

const spatial = new SpatialHash<string>(40);
spatial.insert("A", { minX: 590, minY: 230, maxX: 680, maxY: 300 }, "A");
spatial.insert("B", { minX: 700, minY: 270, maxX: 790, maxY: 350 }, "B");
spatial.insert("C", { minX: 630, minY: 340, maxX: 740, maxY: 410 }, "C");
const query = { minX: 650, minY: 260, maxX: 750, maxY: 360 };
const hits = spatial.query(query).map((entry) => entry.id).join(", ");

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500">
  <rect width="900" height="500" fill="#f8faf7"/>
  <text x="40" y="35" font-family="system-ui, sans-serif" font-size="24" font-weight="700" fill="#17324d">Lubanda Milestone 1 — Geometry &amp; Spatial Diagnostics</text>
  ${panels.join("")}
  ${label(40, 205, `Adaptive Bézier sampling (${samples.length} points)`)}
  <polyline points="${samplePath}" fill="none" stroke="#7c3aed" stroke-width="3"/>
  ${sampleDots}
  ${label(570, 205, `SpatialHash query — hits: ${hits}`)}
  <rect x="590" y="230" width="90" height="70" fill="#0f766e22" stroke="#0f766e" stroke-width="2"/>
  <rect x="700" y="270" width="90" height="80" fill="#dc6b3522" stroke="#dc6b35" stroke-width="2"/>
  <rect x="630" y="340" width="110" height="70" fill="#7c3aed22" stroke="#7c3aed" stroke-width="2"/>
  <rect x="${query.minX}" y="${query.minY}" width="${query.maxX - query.minX}" height="${query.maxY - query.minY}" fill="none" stroke="#111827" stroke-width="3" stroke-dasharray="8 6"/>
  ${label(605, 255, "A")}
  ${label(715, 295, "B")}
  ${label(645, 365, "C")}
  ${label(650, 430, "Dashed rectangle = query bounds")}
</svg>`;

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, svg, "utf8");
console.log(outputPath);

