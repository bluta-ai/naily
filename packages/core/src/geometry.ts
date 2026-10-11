export interface Point {
  x: number;
  y: number;
}

export type Polygon = Point[];

export const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Point, s: number): Point => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Point, b: Point): number => a.x * b.x + a.y * b.y;
export const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export function normalize(a: Point): Point {
  const len = Math.hypot(a.x, a.y);
  if (len === 0) throw new Error("Cannot normalize a zero-length vector");
  return { x: a.x / len, y: a.y / len };
}

/** Rotates the vector +90° (counter-clockwise in a y-up frame). */
export const perp = (a: Point): Point => ({ x: -a.y, y: a.x });

/** Signed shoelace area. Positive when the vertices run counter-clockwise in a y-up frame. */
export function signedArea(poly: Polygon): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

export const area = (poly: Polygon): number => Math.abs(signedArea(poly));

export function centroid(poly: Polygon): Point {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-12) {
    const s = poly.reduce((acc, p) => add(acc, p), { x: 0, y: 0 });
    return scale(s, 1 / poly.length);
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function isConvex(poly: Polygon): boolean {
  let sign = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!;
    const b = poly[(i + 1) % poly.length]!;
    const c = poly[(i + 2) % poly.length]!;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-12) continue;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return sign !== 0;
}

/**
 * Smooth closed curve through the control points (centripetal-free, uniform Catmull-Rom).
 * Returns `samplesPerSpan` points per control point.
 */
export function catmullRomClosed(points: Polygon, samplesPerSpan = 12): Polygon {
  const n = points.length;
  if (n < 3) return points.slice();
  const out: Polygon = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]!;
    const p1 = points[i]!;
    const p2 = points[(i + 1) % n]!;
    const p3 = points[(i + 2) % n]!;
    for (let s = 0; s < samplesPerSpan; s++) {
      const t = s / samplesPerSpan;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  return out;
}

/**
 * Moves every vertex along its averaged normal. Positive `d` grows the shape, negative shrinks it.
 * Good enough for the smooth, convex-ish outlines nails have.
 */
export function offsetPolygon(poly: Polygon, d: number): Polygon {
  const n = poly.length;
  const orientation = Math.sign(signedArea(poly)) || 1;
  return poly.map((p, i) => {
    const prev = poly[(i - 1 + n) % n]!;
    const next = poly[(i + 1) % n]!;
    const tangent = sub(next, prev);
    const len = Math.hypot(tangent.x, tangent.y);
    if (len === 0) return p;
    // For a CCW polygon (y-up) the outward normal is the tangent rotated -90°.
    const outward = { x: (tangent.y / len) * orientation, y: (-tangent.x / len) * orientation };
    return add(p, scale(outward, d));
  });
}

export function bounds(poly: Polygon): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of poly) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** SVG path data for a closed polygon, rounded to 0.01 units. */
export function toPathData(poly: Polygon): string {
  const r = (v: number) => Math.round(v * 100) / 100;
  return poly.map((p, i) => `${i === 0 ? "M" : "L"}${r(p.x)} ${r(p.y)}`).join(" ") + " Z";
}
