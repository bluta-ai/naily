/**
 * Finds the bank card, in the browser. A line-by-line port of apps/vision/naily_vision/card.py:
 * edge contours → card-shaped quads (SAM grid as fallback) → sub-pixel edge refinement.
 */
import type { CV } from "./runtime.ts";

export type Pt = [number, number];
export type Quad = Pt[];

export const CARD_RATIO = 85.6 / 53.98;
const WORK_SIZE = 1200;

export function order(quad: Quad): Quad {
  const cx = quad.reduce((s, p) => s + p[0], 0) / quad.length;
  const cy = quad.reduce((s, p) => s + p[1], 0) / quad.length;
  const q = [...quad].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  for (let i = 1; i < q.length; i++) if (q[i]![0] + q[i]![1] < q[start]![0] + q[start]![1]) start = i;
  return [...q.slice(start), ...q.slice(0, start)];
}

export function sideRatio(q: Quad): number {
  const s = [0, 1, 2, 3].map((i) => Math.hypot(q[(i + 1) % 4]![0] - q[i]![0], q[(i + 1) % 4]![1] - q[i]![1]));
  const a = (s[0]! + s[2]!) / 2;
  const b = (s[1]! + s[3]!) / 2;
  return Math.max(a, b) / Math.max(1e-6, Math.min(a, b));
}

function polygonArea(q: Quad): number {
  let a = 0;
  for (let i = 0; i < q.length; i++) {
    const p = q[i]!;
    const n = q[(i + 1) % q.length]!;
    a += p[0] * n[1] - n[0] * p[1];
  }
  return Math.abs(a) / 2;
}

export function pointInQuad(q: Quad, x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = q.length - 1; i < q.length; j = i++) {
    const [xi, yi] = q[i]!;
    const [xj, yj] = q[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Median of an 8-bit single-channel Mat. */
function median(cv: CV, m: CV): number {
  const hist = new Uint32Array(256);
  const d: Uint8Array = m.data;
  for (let i = 0; i < d.length; i++) hist[d[i]!]!++;
  let acc = 0;
  const half = d.length / 2;
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!;
    if (acc >= half) return v;
  }
  void cv;
  return 128;
}

/** Contours → hull → 4-point approximation. Returns the quad and the contour area, or null. */
function quadFromContour(cv: CV, c: CV): { quad: Quad; area: number; convex: boolean } | null {
  const area = cv.contourArea(c);
  const hull = new cv.Mat();
  const approx = new cv.Mat();
  try {
    cv.convexHull(c, hull, false, true);
    cv.approxPolyDP(hull, approx, 0.02 * cv.arcLength(hull, true), true);
    if (approx.rows !== 4) return null;
    const pts: Quad = [];
    for (let i = 0; i < 4; i++) pts.push([approx.data32S[i * 2], approx.data32S[i * 2 + 1]]);
    return { quad: pts, area, convex: cv.isContourConvex(approx) };
  } finally {
    hull.delete();
    approx.delete();
  }
}

type Rough = { score: number; quad: Quad };

function edgeCandidates(cv: CV, small: CV, s: number, avoid: Pt[]): Rough[] {
  const areaImg = small.rows * small.cols;
  const lab = new cv.Mat();
  const hsv = new cv.Mat();
  cv.cvtColor(small, lab, cv.COLOR_RGB2Lab);
  cv.cvtColor(small, hsv, cv.COLOR_RGB2HSV);
  const labCh = new cv.MatVector();
  const hsvCh = new cv.MatVector();
  cv.split(lab, labCh);
  cv.split(hsv, hsvCh);
  const channels = [labCh.get(0), labCh.get(1), labCh.get(2), hsvCh.get(1)];
  const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
  const out: Rough[] = [];
  const blur = new cv.Mat();
  const edges = new cv.Mat();
  for (const ch of channels) {
    cv.GaussianBlur(ch, blur, new cv.Size(5, 5), 0);
    const med = median(cv, blur);
    for (const [loK, hiK] of [
      [0.66, 1.33],
      [0.33, 0.8],
    ] as const) {
      let lo = Math.max(5, loK * med);
      let hi = Math.max(20, hiK * med);
      if (hi - lo < 10) [lo, hi] = [10, 40];
      cv.Canny(blur, edges, lo, hi);
      cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel);
      const contours = new cv.MatVector();
      const hier = new cv.Mat();
      cv.findContours(edges, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_NONE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const area = cv.contourArea(c);
        if (area >= 0.01 * areaImg && area <= 0.6 * areaImg) {
          const found = quadFromContour(cv, c);
          if (found && found.convex) {
            const quad = order(found.quad);
            const ratio = sideRatio(quad);
            const solidity = area / Math.max(1, polygonArea(quad));
            const coversHand = avoid.some(([x, y]) => pointInQuad(quad, x * s, y * s));
            if (Math.abs(ratio - CARD_RATIO) / CARD_RATIO <= 0.3 && solidity >= 0.85 && !coversHand) {
              const score = (1 - Math.abs(ratio - CARD_RATIO) / CARD_RATIO) * Math.min(1, solidity) + 0.2 * Math.sqrt(area / areaImg);
              out.push({ score, quad: quad.map(([x, y]) => [x / s, y / s] as Pt) });
            }
          }
        }
        c.delete();
      }
      contours.delete();
      hier.delete();
    }
  }
  [lab, hsv, blur, edges, kernel].forEach((m) => m.delete());
  channels.forEach((m) => m.delete());
  labCh.delete();
  hsvCh.delete();
  return out;
}

/** Card-shaped segments from SAM prompts on a grid (fallback for busy backgrounds). */
export function samCandidates(
  cv: CV,
  segment: (points: Pt[], labels: number[]) => { masks: Uint8Array[]; scores: number[]; width: number; height: number; scale: number },
  avoid: Pt[],
  width: number,
  height: number,
): Rough[] {
  const out: Rough[] = [];
  let covered: Uint8Array | null = null;
  for (let gy = 0; gy < 8; gy++) {
    for (let gx = 0; gx < 10; gx++) {
      const x = (0.06 + (0.88 * gx) / 9) * width;
      const y = (0.08 + (0.84 * gy) / 7) * height;
      const r = segment([[x, y]], [1]);
      if (!covered) covered = new Uint8Array(r.width * r.height);
      if (covered[Math.floor(y * r.scale) * r.width + Math.floor(x * r.scale)]) continue;
      r.masks.forEach((m, k) => {
        let n = 0;
        for (let i = 0; i < m.length; i++) n += m[i]!;
        const frac = n / m.length;
        if (frac < 0.01 || frac > 0.5 || r.scores[k]! < 0.7) return;
        const mat = cv.matFromArray(r.height, r.width, cv.CV_8U, m);
        const contours = new cv.MatVector();
        const hier = new cv.Mat();
        cv.findContours(mat, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
        let best = -1;
        let bestArea = 0;
        for (let i = 0; i < contours.size(); i++) {
          const a = cv.contourArea(contours.get(i));
          if (a > bestArea) [best, bestArea] = [i, a];
        }
        const found = best >= 0 ? quadFromContour(cv, contours.get(best)) : null;
        mat.delete();
        contours.delete();
        hier.delete();
        if (!found) return;
        const quad = order(found.quad).map(([qx, qy]) => [qx / r.scale, qy / r.scale] as Pt);
        const ratio = sideRatio(quad);
        const solidity = found.area / Math.max(1, polygonArea(found.quad));
        if (Math.abs(ratio - CARD_RATIO) / CARD_RATIO > 0.3 || solidity < 0.9) return;
        if (avoid.some(([ax, ay]) => pointInQuad(quad, ax, ay))) return;
        for (let i = 0; i < m.length; i++) if (m[i]) covered![i] = 1;
        out.push({ score: (1 - Math.abs(ratio - CARD_RATIO) / CARD_RATIO) * solidity + 0.2 * Math.sqrt(frac), quad });
      });
    }
  }
  return out;
}

/** Bilinear sample of a 3-channel 8-bit image. */
function sample3(data: Uint8Array, w: number, x: number, y: number, out: Float64Array) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const i00 = (y0 * w + x0) * 3;
  const i10 = i00 + 3;
  const i01 = i00 + w * 3;
  const i11 = i01 + 3;
  for (let c = 0; c < 3; c++) {
    out[c] =
      data[i00 + c]! * (1 - fx) * (1 - fy) + data[i10 + c]! * fx * (1 - fy) + data[i01 + c]! * (1 - fx) * fy + data[i11 + c]! * fx * fy;
  }
}

/** Robust total-least-squares line fit (Huber weights), like cv2.fitLine(DIST_HUBER). */
function fitLine(pts: Pt[]): { p: Pt; d: Pt } {
  let w = pts.map(() => 1);
  let p: Pt = [0, 0];
  let d: Pt = [1, 0];
  for (let iter = 0; iter < 6; iter++) {
    const sw = w.reduce((a, b) => a + b, 0);
    const mx = pts.reduce((s, q, i) => s + q[0] * w[i]!, 0) / sw;
    const my = pts.reduce((s, q, i) => s + q[1] * w[i]!, 0) / sw;
    let sxx = 0;
    let syy = 0;
    let sxy = 0;
    pts.forEach((q, i) => {
      const dx = q[0] - mx;
      const dy = q[1] - my;
      sxx += w[i]! * dx * dx;
      syy += w[i]! * dy * dy;
      sxy += w[i]! * dx * dy;
    });
    const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    p = [mx, my];
    d = [Math.cos(theta), Math.sin(theta)];
    const C = 1.345;
    w = pts.map((q) => {
      const r = Math.abs((q[0] - p[0]) * d[1] - (q[1] - p[1]) * d[0]);
      return r < C ? 1 : C / r;
    });
  }
  return { p, d };
}

/** Sub-pixel corners: strongest colour step along each side's normals, robust line fits, intersections. */
function refineEdges(lab: Uint8Array, w: number, h: number, quad: Quad): Quad | null {
  const lines: { p: Pt; d: Pt }[] = [];
  const a3 = new Float64Array(3);
  for (let i = 0; i < 4; i++) {
    const a = quad[i]!;
    const b = quad[(i + 1) % 4]!;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    const u: Pt = [dx / length, dy / length];
    const n: Pt = [-u[1], u[0]];
    const reach = Math.max(6, 0.04 * length);
    const offsets: number[] = [];
    for (let o = -reach; o <= reach + 1e-9; o += 0.5) offsets.push(o);
    const found: Pt[] = [];
    for (let k = 0; k < 60; k++) {
      const t = 0.12 + (0.76 * k) / 59;
      const px = a[0] + dx * t;
      const py = a[1] + dy * t;
      const xs = offsets.map((o) => px + o * n[0]);
      const ys = offsets.map((o) => py + o * n[1]);
      if (Math.min(...xs) < 1 || Math.min(...ys) < 1 || Math.max(...xs) > w - 2 || Math.max(...ys) > h - 2) continue;
      const prof = offsets.map((_, j) => {
        sample3(lab, w, xs[j]!, ys[j]!, a3);
        return [a3[0]!, a3[1]!, a3[2]!];
      });
      const grad: number[] = [];
      for (let j = 0; j + 2 < prof.length; j++) {
        const p0 = prof[j]!;
        const p2 = prof[j + 2]!;
        grad.push(Math.hypot(p2[0]! - p0[0]!, p2[1]! - p0[1]!, p2[2]! - p0[2]!));
      }
      let best = 0;
      for (let j = 1; j < grad.length; j++) if (grad[j]! > grad[best]!) best = j;
      if (grad[best]! < 6) continue;
      let off = 0;
      if (best > 0 && best < grad.length - 1) {
        const y0 = grad[best - 1]!;
        const y1 = grad[best]!;
        const y2 = grad[best + 1]!;
        const den = y0 - 2 * y1 + y2;
        off = den !== 0 ? (0.5 * (y0 - y2)) / den : 0;
      }
      found.push([xs[best + 1]! + n[0] * off * 0.5, ys[best + 1]! + n[1] * off * 0.5]);
    }
    if (found.length < 15) return null;
    let pts = found;
    let line = fitLine(pts);
    for (let pass = 0; pass < 2; pass++) {
      line = fitLine(pts);
      const dist = pts.map((q) => Math.abs((q[0] - line.p[0]) * line.d[1] - (q[1] - line.p[1]) * line.d[0]));
      const sorted = [...dist].sort((x, y) => x - y);
      const med = sorted[Math.floor(sorted.length / 2)]!;
      const keep = pts.filter((_, j) => dist[j]! < Math.max(1.5, med * 3));
      if (keep.length < 12) return null;
      pts = keep;
    }
    lines.push(line);
  }
  const out: Quad = [];
  for (let i = 0; i < 4; i++) {
    const l1 = lines[(i + 3) % 4]!;
    const l2 = lines[i]!;
    const det = l1.d[0] * -l2.d[1] - -l2.d[0] * l1.d[1];
    if (Math.abs(det) < 1e-6) return null;
    const rx = l2.p[0] - l1.p[0];
    const ry = l2.p[1] - l1.p[1];
    const s = (rx * -l2.d[1] - -l2.d[0] * ry) / det;
    out.push([l1.p[0] + s * l1.d[0], l1.p[1] + s * l1.d[1]]);
  }
  return out;
}

function bestRefined(lab: Uint8Array, w: number, h: number, rough: Rough[], s: number): Quad | null {
  rough.sort((a, b) => b.score - a.score);
  let best: Rough | null = null;
  const seen: Quad[] = [];
  for (const { score, quad } of rough) {
    if (seen.some((q) => Math.max(...q.flatMap((p, i) => [Math.abs(p[0] - quad[i]![0]), Math.abs(p[1] - quad[i]![1])])) < 4 / s)) continue;
    seen.push(quad);
    if (seen.length > 6) break;
    const r = refineEdges(lab, w, h, quad);
    if (!r) continue;
    const refined = order(r);
    const xs = quad.map((p) => p[0]);
    const moved = Math.max(...refined.flatMap((p, i) => [Math.abs(p[0] - quad[i]![0]), Math.abs(p[1] - quad[i]![1])]));
    if (Math.abs(sideRatio(refined) - CARD_RATIO) / CARD_RATIO > 0.3 || moved > 0.1 * (Math.max(...xs) - Math.min(...xs))) continue;
    if (!best || score > best.score) best = { score, quad: refined };
  }
  return best?.quad ?? null;
}

/**
 * `rgb` is a cv.Mat (8UC3, full resolution). `avoid` are hand landmarks the card must not contain.
 * `samFallback` runs SAM on a grid when edges find nothing.
 */
export function detectCard(cv: CV, rgb: CV, avoid: Pt[], samFallback?: () => Rough[]): Quad | null {
  const h = rgb.rows;
  const w = rgb.cols;
  const s = Math.min(1, WORK_SIZE / Math.max(h, w));
  const small = new cv.Mat();
  if (s < 1) cv.resize(rgb, small, new cv.Size(Math.round(w * s), Math.round(h * s)), 0, 0, cv.INTER_AREA);
  else rgb.copyTo(small);
  const rough = edgeCandidates(cv, small, s, avoid);
  small.delete();
  const labMat = new cv.Mat();
  cv.cvtColor(rgb, labMat, cv.COLOR_RGB2Lab);
  const lab = new Uint8Array(labMat.data);
  labMat.delete();
  let quad = bestRefined(lab, w, h, rough, s);
  if (!quad && samFallback) quad = bestRefined(lab, w, h, samFallback(), 1);
  return quad;
}
