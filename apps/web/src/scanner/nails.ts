/**
 * Finds the nails in the browser. A port of apps/vision/naily_vision/nails.py:
 * MediaPipe finds the fingers, YOLO finds nails, MobileSAM re-traces each nail on an upright crop.
 */
import type { CV, Runtime } from "./runtime.ts";
import type { Pt } from "./card.ts";

export const FINGER_JOINTS: Record<number, [number, number]> = { 1: [3, 4], 2: [7, 8], 3: [11, 12], 4: [15, 16], 5: [19, 20] };
const SAM_SIZE = 1024;
const YOLO_SIZE = 640;

export interface Hand {
  landmarks: Pt[];
  chirality: number;
}

export interface Nail {
  finger: number;
  contour: Pt[];
  tip: Pt;
  confidence: number;
}

// ------------------------------------------------------------------ hands

export function detectHands(rt: Runtime, rgb: Uint8Array, width: number, height: number): Hand[] {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    rgba[i] = rgb[j]!;
    rgba[i + 1] = rgb[j + 1]!;
    rgba[i + 2] = rgb[j + 2]!;
    rgba[i + 3] = 255;
  }
  const result = rt.hands.detect(new ImageData(rgba, width, height));
  return result.landmarks.map((lms) => {
    const pts: Pt[] = lms.map((l) => [l.x * width, l.y * height]);
    const axis = [pts[9]![0] - pts[0]![0], pts[9]![1] - pts[0]![1]];
    const across = [pts[17]![0] - pts[5]![0], pts[17]![1] - pts[5]![1]];
    return { landmarks: pts, chirality: axis[0]! * across[1]! - axis[1]! * across[0]! > 0 ? 1 : -1 };
  });
}

/** Back of a left hand: chirality -1; back of a right hand: +1 (see nails.py). */
export const isBackOfHand = (hand: Hand, side: "L" | "R") => hand.chirality === (side === "L" ? -1 : 1);

export function handRegion(hand: Hand, w: number, h: number, margin = 0.25): [number, number, number, number] {
  const xs = hand.landmarks.map((p) => p[0]);
  const ys = hand.landmarks.map((p) => p[1]);
  const pad = margin * Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return [
    Math.floor(Math.max(0, Math.min(...xs) - pad)),
    Math.floor(Math.max(0, Math.min(...ys) - pad)),
    Math.floor(Math.min(w, Math.max(...xs) + pad)),
    Math.floor(Math.min(h, Math.max(...ys) + pad)),
  ];
}

// ------------------------------------------------------------------ YOLO

interface Candidate {
  /** Mask over the hand region, 1 = nail. */
  mask: Uint8Array;
  x0: number;
  y0: number;
  w: number;
  h: number;
  score: number;
  cx: number;
  cy: number;
}

function iouBox(a: number[], b: number[]): number {
  const x0 = Math.max(a[0]!, b[0]!);
  const y0 = Math.max(a[1]!, b[1]!);
  const x1 = Math.min(a[0]! + a[2]!, b[0]! + b[2]!);
  const y1 = Math.min(a[1]! + a[3]!, b[1]! + b[3]!);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a[2]! * a[3]! + b[2]! * b[3]! - inter);
}

async function detectCandidates(rt: Runtime, img: CV, region: [number, number, number, number]): Promise<Candidate[]> {
  const { cv, ort } = rt;
  const [x0, y0, x1, y1] = region;
  const cw = x1 - x0;
  const ch = y1 - y0;
  const s = YOLO_SIZE / Math.max(ch, cw);
  const nw = Math.round(cw * s);
  const nh = Math.round(ch * s);
  const crop = img.roi(new cv.Rect(x0, y0, cw, ch));
  const resized = new cv.Mat();
  cv.resize(crop, resized, new cv.Size(nw, nh), 0, 0, cv.INTER_AREA);
  crop.delete();
  const blob = new Float32Array(3 * YOLO_SIZE * YOLO_SIZE).fill(114 / 255);
  const plane = YOLO_SIZE * YOLO_SIZE;
  const rd: Uint8Array = resized.data;
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      const i = (y * nw + x) * 3;
      const o = y * YOLO_SIZE + x;
      blob[o] = rd[i]! / 255;
      blob[plane + o] = rd[i + 1]! / 255;
      blob[2 * plane + o] = rd[i + 2]! / 255;
    }
  }
  resized.delete();
  const out = await rt.yolo.run({ images: new ort.Tensor("float32", blob, [1, 3, YOLO_SIZE, YOLO_SIZE]) });
  const preds = out[rt.yolo.outputNames[0]!]!.data as Float32Array; // (1, 37, 8400)
  const protos = out[rt.yolo.outputNames[1]!]!.data as Float32Array; // (1, 32, 160, 160)
  const N = 8400;
  const rows: { box: number[]; score: number; i: number }[] = [];
  for (let i = 0; i < N; i++) {
    const score = preds[4 * N + i]!;
    if (score <= 0.25) continue;
    const cx = preds[i]!;
    const cy = preds[N + i]!;
    const bw = preds[2 * N + i]!;
    const bh = preds[3 * N + i]!;
    rows.push({ box: [cx - bw / 2, cy - bh / 2, bw, bh], score, i });
  }
  rows.sort((a, b) => b.score - a.score);
  const kept: typeof rows = [];
  for (const r of rows) if (kept.every((k) => iouBox(k.box, r.box) <= 0.5)) kept.push(r);

  const result: Candidate[] = [];
  for (const r of kept) {
    const m160 = new Float32Array(160 * 160);
    for (let c = 0; c < 32; c++) {
      const coeff = preds[(5 + c) * N + r.i]!;
      const base = c * 160 * 160;
      for (let p = 0; p < m160.length; p++) m160[p]! += coeff * protos[base + p]!;
    }
    for (let p = 0; p < m160.length; p++) m160[p] = 1 / (1 + Math.exp(-m160[p]!));
    const m = cv.matFromArray(160, 160, cv.CV_32F, m160);
    const big = new cv.Mat();
    cv.resize(m, big, new cv.Size(YOLO_SIZE, YOLO_SIZE), 0, 0, cv.INTER_LINEAR);
    const cropped = big.roi(new cv.Rect(0, 0, nw, nh));
    const final = new cv.Mat();
    cv.resize(cropped, final, new cv.Size(cw, ch), 0, 0, cv.INTER_LINEAR);
    const fd: Float32Array = final.data32F;
    const [bx, by, bw, bh] = r.box.map((v) => v / s) as [number, number, number, number];
    const mask = new Uint8Array(cw * ch);
    let n = 0;
    let sx = 0;
    let sy = 0;
    const yA = Math.floor(Math.max(0, by));
    const yB = Math.min(ch - 1, Math.floor(by + bh));
    const xA = Math.floor(Math.max(0, bx));
    const xB = Math.min(cw - 1, Math.floor(bx + bw));
    for (let y = yA; y <= yB; y++) {
      for (let x = xA; x <= xB; x++) {
        if (fd[y * cw + x]! > 0.5) {
          mask[y * cw + x] = 1;
          n++;
          sx += x;
          sy += y;
        }
      }
    }
    [m, big, cropped, final].forEach((mat) => mat.delete());
    if (n < 20) continue;
    result.push({ mask, x0, y0, w: cw, h: ch, score: r.score, cx: x0 + sx / n, cy: y0 + sy / n });
  }
  return result;
}

// ------------------------------------------------------------------ SAM

export interface SamEmbedding {
  emb: unknown;
  scale: number;
}

/** Encodes an RGB cv.Mat for SAM (longest side 1024). */
export async function samEmbed(rt: Runtime, img: CV): Promise<SamEmbedding> {
  const { cv } = rt;
  const s = SAM_SIZE / Math.max(img.rows, img.cols);
  const resized = new cv.Mat();
  cv.resize(img, resized, new cv.Size(Math.round(img.cols * s), Math.round(img.rows * s)), 0, 0, cv.INTER_LINEAR);
  const data = Float32Array.from(resized.data as Uint8Array);
  const dims = [resized.rows, resized.cols, 3];
  resized.delete();
  return { emb: await rt.encode(data, dims), scale: s };
}

/** Masks (as 0/1 bytes at `size`) and predicted IoUs for one prompt. */
export async function samDecode(
  rt: Runtime,
  e: SamEmbedding,
  size: [number, number],
  points: Pt[],
  labels: number[],
): Promise<{ masks: Uint8Array[]; scores: number[] }> {
  const { ort } = rt;
  const coords = new Float32Array([...points.flatMap(([x, y]) => [x * e.scale, y * e.scale]), 0, 0]);
  const labs = new Float32Array([...labels, -1]);
  const n = points.length + 1;
  const out = await rt.decoder.run({
    image_embeddings: e.emb as InstanceType<typeof ort.Tensor>,
    point_coords: new ort.Tensor("float32", coords, [1, n, 2]),
    point_labels: new ort.Tensor("float32", labs, [1, n]),
    mask_input: new ort.Tensor("float32", new Float32Array(256 * 256), [1, 1, 256, 256]),
    has_mask_input: new ort.Tensor("float32", new Float32Array([0]), [1]),
    orig_im_size: new ort.Tensor("float32", new Float32Array(size), [2]),
  });
  const masksT = out["masks"]!;
  const ious = out["iou_predictions"]!.data as Float32Array;
  const [, k, h, w] = masksT.dims as number[];
  const md = masksT.data as Float32Array;
  const masks: Uint8Array[] = [];
  for (let i = 0; i < k!; i++) {
    const m = new Uint8Array(h! * w!);
    const base = i * h! * w!;
    for (let p = 0; p < m.length; p++) m[p] = md[base + p]! > 0 ? 1 : 0;
    masks.push(m);
  }
  return { masks, scores: Array.from(ious.slice(0, k)) };
}

function mainComponent(cv: CV, mask: Uint8Array, w: number, h: number): Uint8Array {
  const m = cv.matFromArray(h, w, cv.CV_8U, mask);
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const cents = new cv.Mat();
  const n = cv.connectedComponentsWithStats(m, labels, stats, cents);
  let out = mask;
  if (n > 1) {
    let best = 1;
    for (let i = 2; i < n; i++) if (stats.intAt(i, cv.CC_STAT_AREA) > stats.intAt(best, cv.CC_STAT_AREA)) best = i;
    const ld: Int32Array = labels.data32S;
    out = new Uint8Array(mask.length);
    for (let p = 0; p < ld.length; p++) out[p] = ld[p] === best ? 1 : 0;
  }
  [m, labels, stats, cents].forEach((x) => x.delete());
  return out;
}

function iou(a: Uint8Array, b: Uint8Array): number {
  let inter = 0;
  let union = 0;
  for (let i = 0; i < a.length; i++) {
    inter += a[i]! & b[i]!;
    union += a[i]! | b[i]!;
  }
  return union ? inter / union : 0;
}

function largestContour(cv: CV, mask: Uint8Array, w: number, h: number): Pt[] {
  const m = cv.matFromArray(h, w, cv.CV_8U, mask);
  const contours = new cv.MatVector();
  const hier = new cv.Mat();
  cv.findContours(m, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_NONE);
  let best = 0;
  let bestArea = -1;
  for (let i = 0; i < contours.size(); i++) {
    const a = cv.contourArea(contours.get(i));
    if (a > bestArea) [best, bestArea] = [i, a];
  }
  const c = contours.get(best);
  const d: Int32Array = c.data32S;
  const pts: Pt[] = [];
  for (let i = 0; i < d.length; i += 2) pts.push([d[i]!, d[i + 1]!]);
  [m, contours, hier].forEach((x) => x.delete());
  return pts;
}

/** Keeps only the lowest harmonics of a closed contour (see nails.py:fourier_smooth). */
export function fourierSmooth(contour: Pt[], harmonics = 6, samples = 256): Pt[] {
  const closed = [...contour, contour[0]!];
  const d = [0];
  for (let i = 1; i < closed.length; i++) d.push(d[i - 1]! + Math.hypot(closed[i]![0] - closed[i - 1]![0], closed[i]![1] - closed[i - 1]![1]));
  const total = d[d.length - 1]!;
  const re: number[] = [];
  const im: number[] = [];
  let j = 0;
  for (let k = 0; k < samples; k++) {
    const t = (k * total) / samples;
    while (j < d.length - 2 && d[j + 1]! < t) j++;
    const f = d[j + 1]! > d[j]! ? (t - d[j]!) / (d[j + 1]! - d[j]!) : 0;
    re.push(closed[j]![0] + f * (closed[j + 1]![0] - closed[j]![0]));
    im.push(closed[j]![1] + f * (closed[j + 1]![1] - closed[j]![1]));
  }
  const coef: [number, number, number][] = [];
  for (let f = -harmonics; f <= harmonics; f++) {
    let cr = 0;
    let ci = 0;
    for (let k = 0; k < samples; k++) {
      const a = (-2 * Math.PI * f * k) / samples;
      cr += re[k]! * Math.cos(a) - im[k]! * Math.sin(a);
      ci += re[k]! * Math.sin(a) + im[k]! * Math.cos(a);
    }
    coef.push([f, cr / samples, ci / samples]);
  }
  const out: Pt[] = [];
  for (let k = 0; k < samples; k++) {
    let x = 0;
    let y = 0;
    for (const [f, cr, ci] of coef) {
      const a = (2 * Math.PI * f * k) / samples;
      x += cr * Math.cos(a) - ci * Math.sin(a);
      y += cr * Math.sin(a) + ci * Math.cos(a);
    }
    out.push([x, y]);
  }
  return out;
}

/** Affine (2x3) helpers. */
type Affine = [number, number, number, number, number, number];
const applyAffine = (m: Affine, [x, y]: Pt): Pt => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
function invertAffine(m: Affine): Affine {
  const det = m[0] * m[4] - m[1] * m[3];
  const a = m[4] / det;
  const b = -m[1] / det;
  const c = -m[3] / det;
  const d = m[0] / det;
  return [a, b, -(a * m[2] + b * m[5]), c, d, -(c * m[2] + d * m[5])];
}

async function refineNail(rt: Runtime, img: CV, cand: Candidate, up: Pt, finger: number): Promise<Nail> {
  const { cv } = rt;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let y = 0; y < cand.h; y++) for (let x = 0; x < cand.w; x++) if (cand.mask[y * cand.w + x]) (xs.push(x + cand.x0), ys.push(y + cand.y0));
  const centre: Pt = [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length];
  const extent = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const S = 512;
  const k = S / (extent * 2.6);
  const angle = (Math.atan2(up[1], up[0]) * 180) / Math.PI + 90;
  // Same matrix as cv2.getRotationMatrix2D(centre, angle, k), then shifted to centre the crop.
  const r = (angle * Math.PI) / 180;
  const al = k * Math.cos(r);
  const be = k * Math.sin(r);
  const rot: Affine = [al, be, (1 - al) * centre[0] - be * centre[1], -be, al, be * centre[0] + (1 - al) * centre[1]];
  rot[2] += S / 2 - centre[0];
  rot[5] += S / 2 - centre[1];

  const rotMat = cv.matFromArray(2, 3, cv.CV_64F, rot);
  const crop = new cv.Mat();
  cv.warpAffine(img, crop, rotMat, new cv.Size(S, S), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
  // The candidate mask lives in hand-region coordinates: shift the transform accordingly.
  const regRot: Affine = [rot[0], rot[1], rot[2] + rot[0] * cand.x0 + rot[1] * cand.y0, rot[3], rot[4], rot[5] + rot[3] * cand.x0 + rot[4] * cand.y0];
  const regMat = cv.matFromArray(2, 3, cv.CV_64F, regRot);
  const coarseSrc = cv.matFromArray(cand.h, cand.w, cv.CV_8U, cand.mask);
  const coarseDst = new cv.Mat();
  cv.warpAffine(coarseSrc, coarseDst, regMat, new cv.Size(S, S), cv.INTER_NEAREST, cv.BORDER_CONSTANT, new cv.Scalar(0));
  const coarse = new Uint8Array(coarseDst.data);
  [rotMat, regMat, coarseSrc, coarseDst].forEach((m) => m.delete());

  let bx0 = S;
  let by0 = S;
  let bx1 = 0;
  let by1 = 0;
  let sx = 0;
  let sy = 0;
  let n = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!coarse[y * S + x]) continue;
      bx0 = Math.min(bx0, x);
      by0 = Math.min(by0, y);
      bx1 = Math.max(bx1, x);
      by1 = Math.max(by1, y);
      sx += x;
      sy += y;
      n++;
    }
  }
  const emb = await samEmbed(rt, crop);
  crop.delete();
  const { masks, scores } = await samDecode(rt, emb, [S, S], [[sx / n, sy / n], [bx0, by0], [bx1, by1]], [1, 2, 3]);
  let bestScore = 0;
  let best: { mask: Uint8Array; agreement: number } | null = null;
  masks.forEach((m, i) => {
    const comp = mainComponent(cv, m, S, S);
    const agreement = iou(comp, coarse);
    const sc = agreement * (0.5 + 0.5 * scores[i]!);
    if (sc > bestScore) [bestScore, best] = [sc, { mask: comp, agreement }];
  });
  let mask: Uint8Array;
  let conf: number;
  const chosen = best as { mask: Uint8Array; agreement: number } | null;
  if (!chosen || chosen.agreement < 0.6) {
    mask = coarse;
    conf = 0.5;
  } else {
    mask = chosen.mask;
    conf = chosen.agreement;
  }
  const contour = fourierSmooth(largestContour(cv, mask, S, S));
  const cxs = contour.map((p) => p[0]);
  const cys = contour.map((p) => p[1]);
  if (Math.min(...cxs) <= 1 || Math.min(...cys) <= 1 || Math.max(...cxs) >= S - 2 || Math.max(...cys) >= S - 2) conf *= 0.5;
  const inv = invertAffine(rot);
  return { finger, contour: contour.map((p) => applyAffine(inv, p)), tip: up, confidence: conf };
}

/** Assigns detected nails to the hand's fingers and refines each one. */
export async function findNails(rt: Runtime, img: CV, hand: Hand, fingers: number[], onNail?: () => void): Promise<Map<number, Nail>> {
  const candidates = await detectCandidates(rt, img, handRegion(hand, img.cols, img.rows));
  const result = new Map<number, Nail>();
  const used = new Set<number>();
  const jobs: Promise<void>[] = [];
  for (const finger of [1, 2, 3, 4, 5]) {
    const [dipI, tipI] = FINGER_JOINTS[finger]!;
    const dip = hand.landmarks[dipI]!;
    const tip = hand.landmarks[tipI]!;
    const seg: Pt = [tip[0] - dip[0], tip[1] - dip[1]];
    const segLen = Math.hypot(...seg);
    if (segLen < 5) continue;
    const up: Pt = [seg[0] / segLen, seg[1] / segLen];
    const expected: Pt = [dip[0] + seg[0] * 0.65, dip[1] + seg[1] * 0.65];
    let best = -1;
    let bestD = Infinity;
    candidates.forEach((c, i) => {
      if (used.has(i)) return;
      const d = Math.hypot(c.cx - expected[0], c.cy - expected[1]);
      if (d < bestD) [best, bestD] = [i, d];
    });
    if (best < 0 || bestD > 0.7 * segLen) continue;
    used.add(best);
    if (!fingers.includes(finger)) continue;
    const cand = candidates[best]!;
    // Nails are refined concurrently: the slow encoder step runs in parallel workers.
    jobs.push(
      refineNail(rt, img, cand, up, finger).then((nail) => {
        nail.confidence *= Math.min(1, cand.score / 0.6);
        result.set(finger, nail);
        onNail?.();
      }),
    );
  }
  await Promise.all(jobs);
  return result;
}

/** 32 points: index 0 on the free edge, index 16 on the cuticle (see nails.py:resample_outline). */
export function resampleOutline(contour: Pt[], tip: Pt, n = 32): Pt[] {
  const proj = contour.map((p) => p[0] * tip[0] + p[1] * tip[1]);
  let iTip = 0;
  let iCut = 0;
  proj.forEach((v, i) => {
    if (v > proj[iTip]!) iTip = i;
    if (v < proj[iCut]!) iCut = i;
  });
  const pts = [...contour.slice(iTip), ...contour.slice(0, iTip)];
  const cut = (iCut - iTip + contour.length) % contour.length;
  const first = resampleOpen(pts.slice(0, cut + 1), n / 2 + 1).slice(0, -1);
  const second = resampleOpen([...pts.slice(cut), pts[0]!], n / 2 + 1).slice(0, -1);
  return [...first, ...second];
}

function resampleOpen(pts: Pt[], m: number): Pt[] {
  const d = [0];
  for (let i = 1; i < pts.length; i++) d.push(d[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]));
  const total = d[d.length - 1]!;
  if (total === 0) return Array.from({ length: m }, () => pts[0]!);
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k < m; k++) {
    const t = (k * total) / (m - 1);
    while (j < d.length - 2 && d[j + 1]! < t) j++;
    const f = d[j + 1]! > d[j]! ? Math.min(1, (t - d[j]!) / (d[j + 1]! - d[j]!)) : 0;
    out.push([pts[j]![0] + f * (pts[j + 1]![0] - pts[j]![0]), pts[j]![1] + f * (pts[j + 1]![1] - pts[j]![1])]);
  }
  return out;
}

/** Laplacian-variance blur check on the hand (see scan.py:_is_blurry). */
export function isBlurry(cv: CV, img: CV, hand: Hand): boolean {
  const xs = hand.landmarks.map((p) => p[0]);
  const ys = hand.landmarks.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(img.cols, Math.floor(Math.max(...xs)));
  const y1 = Math.min(img.rows, Math.floor(Math.max(...ys)));
  if (x1 - x0 < 2 || y1 - y0 < 2) return false;
  const roi = img.roi(new cv.Rect(x0, y0, x1 - x0, y1 - y0));
  const gray = new cv.Mat();
  cv.cvtColor(roi, gray, cv.COLOR_RGB2GRAY);
  const small = new cv.Mat();
  cv.resize(gray, small, new cv.Size(400, Math.max(1, Math.round((400 * gray.rows) / gray.cols))));
  const lap = new cv.Mat();
  cv.Laplacian(small, lap, cv.CV_64F);
  const mean = new cv.Mat();
  const std = new cv.Mat();
  cv.meanStdDev(lap, mean, std);
  const variance = std.data64F[0] ** 2;
  [roi, gray, small, lap, mean, std].forEach((m) => m.delete());
  return variance < 25;
}
