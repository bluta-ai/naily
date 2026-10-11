import {
  area,
  catmullRomClosed,
  dot,
  normalize,
  perp,
  sub,
  type Point,
  type Polygon,
} from "./geometry.ts";

export type Hand = "L" | "R";
export type FingerId = `${Hand}${1 | 2 | 3 | 4 | 5}`;

export const FINGER_NAMES = { 1: "thumb", 2: "index", 3: "middle", 4: "ring", 5: "pinky" } as const;

export const FINGERS: FingerId[] = ["L1", "L2", "L3", "L4", "L5", "R1", "R2", "R3", "R4", "R5"];

export const isFingerId = (v: unknown): v is FingerId =>
  typeof v === "string" && (FINGERS as string[]).includes(v);

export const fingerName = (f: FingerId) => FINGER_NAMES[Number(f[1]) as 1 | 2 | 3 | 4 | 5];

/**
 * Number of control points on a nail outline. Point 0 sits on the free edge (tip) and
 * point CUTICLE_INDEX on the cuticle; the rest run around the sides.
 */
export const OUTLINE_POINTS = 8;
export const CUTICLE_INDEX = OUTLINE_POINTS / 2;

/** A nail outline on the flat table plane, in millimetres. */
export interface NailOutline {
  finger: FingerId;
  points: Point[];
  /** True when the nail was not scanned but mirrored from the other hand. */
  estimated?: boolean;
}

export type NailShape = "square" | "squoval" | "round" | "oval" | "almond" | "stiletto";

export interface NailMeasurement {
  finger: FingerId;
  widthMm: number;
  lengthMm: number;
  areaMm2: number;
  shape: NailShape;
  size: number;
  /** Smoothed outline in the nail's own frame: tip at y=0, cuticle at y=lengthMm, x from 0 to widthMm. */
  outline: Polygon;
  estimated: boolean;
}

/** Default oval outline (control points) centred on `c`, tip pointing to -y. */
export function defaultOutline(c: Point, width: number, length: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < OUTLINE_POINTS; i++) {
    const a = (i / OUTLINE_POINTS) * Math.PI * 2;
    pts.push({ x: c.x + (Math.sin(a) * width) / 2, y: c.y - (Math.cos(a) * length) / 2 });
  }
  return pts;
}

/**
 * Re-expresses a nail outline in its own frame: the cuticle→tip axis becomes vertical with the
 * tip at the top (y=0) and the cuticle at the bottom. The transform is a pure rotation plus
 * translation, so the shape is never mirrored or distorted.
 */
export function toNailFrame(outline: NailOutline, samplesPerSpan = 12): Polygon {
  const tip = outline.points[0]!;
  const cuticle = outline.points[CUTICLE_INDEX]!;
  const u = normalize(sub(tip, cuticle));
  // In y-down coordinates the rows [perp(u); -u] form a rotation (determinant +1).
  const v = perp(u);
  const smooth = catmullRomClosed(outline.points, samplesPerSpan);
  const local = smooth.map((p) => ({ x: dot(p, v), y: -dot(p, u) }));
  let minX = Infinity;
  let minY = Infinity;
  for (const p of local) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
  }
  return local.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}

/** Width of the outline across the horizontal line at height `y` (0 if it misses). */
export function widthAt(poly: Polygon, y: number): number {
  const xs: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
      const t = (y - a.y) / (b.y - a.y);
      xs.push(a.x + t * (b.x - a.x));
    }
  }
  if (xs.length < 2) return 0;
  return Math.max(...xs) - Math.min(...xs);
}

/**
 * Classifies the free-edge shape from how quickly the nail narrows towards the tip.
 * `d` is the distance from the tip as a fraction of the nail length.
 */
export function classifyShape(local: Polygon): NailShape {
  let maxY = 0;
  for (const p of local) maxY = Math.max(maxY, p.y);
  const profile = (d: number) => widthAt(local, d * maxY);
  let maxW = 0;
  for (let d = 0.05; d < 1; d += 0.05) maxW = Math.max(maxW, profile(d));
  if (maxW === 0) return "oval";
  const w03 = profile(0.03) / maxW;
  const w10 = profile(0.1) / maxW;
  const w20 = profile(0.2) / maxW;
  if (w03 >= 0.7) return "square";
  if (w03 >= 0.5 && w10 >= 0.85) return "squoval";
  if (w10 >= 0.72) return "round";
  if (w10 >= 0.55) return "oval";
  if (w20 >= 0.5) return "almond";
  return "stiletto";
}

/**
 * Common press-on size chart: size 0 is the widest (thumb) and 11 the narrowest.
 * We always cut to the measured outline, but sizes are useful for stock fallback and reorders.
 */
export const SIZE_CHART_MM = [18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7] as const;

export function sizeForWidth(widthMm: number): number {
  // Pick the narrowest stock size that still covers the nail (0.3 mm of grace).
  for (let i = SIZE_CHART_MM.length - 1; i >= 0; i--) {
    if (SIZE_CHART_MM[i]! >= widthMm - 0.3) return i;
  }
  return 0;
}

export function measureNail(outline: NailOutline): NailMeasurement {
  if (outline.points.length !== OUTLINE_POINTS) {
    throw new Error(`Nail outline needs ${OUTLINE_POINTS} control points`);
  }
  const local = toNailFrame(outline);
  let width = 0;
  let length = 0;
  for (const p of local) {
    width = Math.max(width, p.x);
    length = Math.max(length, p.y);
  }
  return {
    finger: outline.finger,
    widthMm: width,
    lengthMm: length,
    areaMm2: area(local),
    shape: classifyShape(local),
    size: sizeForWidth(width),
    outline: local,
    estimated: Boolean(outline.estimated),
  };
}

const otherHand = (f: FingerId): FingerId => `${f[0] === "L" ? "R" : "L"}${f[1]}` as FingerId;

/**
 * Fills in fingers that were not scanned by mirroring the same finger on the other hand.
 * Returns outlines ordered L1..L5, R1..R5; fingers missing on both hands are left out.
 */
export function completeHandSet(outlines: NailOutline[]): NailOutline[] {
  const byFinger = new Map(outlines.map((o) => [o.finger, o]));
  const result: NailOutline[] = [];
  for (const finger of FINGERS) {
    const own = byFinger.get(finger);
    if (own) {
      result.push(own);
      continue;
    }
    const twin = byFinger.get(otherHand(finger));
    if (!twin || twin.estimated) continue;
    // Mirror across x; reverse the side points so point 0 stays the tip and winding is kept.
    const mirrored = twin.points.map((p) => ({ x: -p.x, y: p.y }));
    const points = [mirrored[0]!, ...mirrored.slice(1).reverse()];
    result.push({ finger, points, estimated: true });
  }
  return result;
}
