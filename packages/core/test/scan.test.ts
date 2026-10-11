import { describe, expect, it } from "vitest";
import { defaultOutline, measureNail, measureScan, REFERENCE_CARD, type ScanResult } from "../src/index.ts";

// A phone 250 mm above the table, 4000x3000 photo, 26 mm-equivalent lens, looking straight down.
const W = 4000;
const H = 3000;
const focalPx = (26 * Math.hypot(W, H)) / Math.hypot(36, 24);
const D = 250;
const project = (x: number, y: number, z = 0): [number, number] => [
  W / 2 + (focalPx * x) / (D - z),
  H / 2 + (focalPx * y) / (D - z),
];

describe("measureScan", () => {
  const card: [number, number][] = [
    project(-60, 20),
    project(-60 + REFERENCE_CARD.widthMm, 20),
    project(-60 + REFERENCE_CARD.widthMm, 20 + REFERENCE_CARD.heightMm),
    project(-60, 20 + REFERENCE_CARD.heightMm),
  ];
  // A dense 32-point oval nail, 14 x 16 mm, sitting 9 mm above the table.
  const nailMm = Array.from({ length: 32 }, (_, i) => {
    const a = (i / 32) * Math.PI * 2;
    return { x: 10 + Math.sin(a) * 7, y: -30 - Math.cos(a) * 8 };
  });
  const scan: ScanResult = {
    ok: true,
    width: W,
    height: H,
    focal35: 26,
    card,
    nails: [{ finger: "L2", points: nailMm.map((p) => project(p.x, p.y, 9)), confidence: 0.9 }],
  };

  it("recovers the camera height", () => {
    expect(measureScan(scan).cameraDistanceMm).toBeCloseTo(D, 0);
  });

  it("measures the nail at its true size despite sitting above the card", () => {
    const m = measureNail(measureScan(scan).nails[0]!);
    expect(m.widthMm).toBeCloseTo(14, 1);
    expect(m.lengthMm).toBeCloseTo(16, 1);
    expect(m.shape).toBe("oval");
  });

  it("falls back to a typical lens when EXIF is missing", () => {
    const m = measureNail(measureScan({ ...scan, focal35: null }).nails[0]!);
    expect(m.widthMm).toBeCloseTo(14, 1);
  });

  it("still accepts 8-point hand-drawn outlines", () => {
    expect(measureNail({ finger: "R2", points: defaultOutline({ x: 0, y: 0 }, 12, 13) }).widthMm).toBeCloseTo(12, 0);
  });
});
