import { calibrateFromCard, pixelsToMm, type Calibration } from "./calibration.ts";
import { add, centroid, scale, sub, type Point } from "./geometry.ts";
import { isFingerId, measureNail, type FingerId, type NailOutline } from "./nail.ts";

/** The four photos the customer takes; one hand holds the phone while the other is scanned. */
export const SCAN_STEPS = ["left-hand", "left-thumb", "right-hand", "right-thumb"] as const;
export type ScanStep = (typeof SCAN_STEPS)[number];

export type ScanProblem =
  | "unreadable"
  | "no-card"
  | "card-too-small"
  | "no-hand"
  | "palm"
  | "wrong-hand"
  | "few-nails"
  | "blurry"
  | "service-unavailable";

interface ScannedNail {
  finger: string;
  points: [number, number][];
  confidence: number;
}

/** What the vision service returns for one photo (pixel coordinates). */
export interface ScanResult {
  ok: boolean;
  problem?: ScanProblem;
  width?: number;
  height?: number;
  focal35?: number | null;
  card?: [number, number][];
  nails?: ScannedNail[];
  /** A thumb seen side-on on a flat-hand photo: used only if the thumb photo fails. */
  sideThumb?: ScannedNail | null;
  missing?: string[];
}

/**
 * How far the nail surface sits above the table the card lies on. Nails are closer to the camera
 * than the card, so without this they would come out a few percent too big.
 */
export const NAIL_HEIGHT_MM = { finger: 9, thumb: 11 } as const;

/** Typical main phone camera when the photo carries no EXIF (e.g. re-compressed by a chat app). */
export const DEFAULT_FOCAL_35MM = 26;
const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);

/** Camera height above the table, from the card's apparent size and the lens focal length. */
export function cameraDistanceMm(cal: Calibration, width: number, height: number, focal35?: number | null): number {
  const f = focal35 && focal35 > 10 && focal35 < 200 ? focal35 : DEFAULT_FOCAL_35MM;
  const focalPx = (f * Math.hypot(width, height)) / FULL_FRAME_DIAGONAL_MM;
  return focalPx * cal.mmPerPixel;
}

/** Shrinks an outline measured on the table plane to its true size at `heightMm` above it. */
export function correctForHeight(points: Point[], distanceMm: number, heightMm: number): Point[] {
  const k = Math.max(0.8, (distanceMm - heightMm) / distanceMm);
  const c = centroid(points);
  return points.map((p) => add(c, scale(sub(p, c), k)));
}

export interface ScanMeasurement {
  nails: (NailOutline & { confidence: number })[];
  sideThumb: (NailOutline & { confidence: number }) | null;
  cameraDistanceMm: number;
  warnings: Calibration["warnings"];
}

/** Converts a successful scan (pixels) into nail outlines in millimetres. */
export function measureScan(scan: ScanResult): ScanMeasurement {
  if (!scan.ok || !scan.card || !scan.width || !scan.height) throw new Error("Scan was not successful");
  const toPoints = (pts: [number, number][]) => pts.map(([x, y]) => ({ x, y }));
  const cal = calibrateFromCard(toPoints(scan.card));
  const distance = cameraDistanceMm(cal, scan.width, scan.height, scan.focal35);
  const convert = (n: ScannedNail) => {
    if (!isFingerId(n.finger)) throw new Error(`Unknown finger ${n.finger}`);
    const finger: FingerId = n.finger;
    const h = finger.endsWith("1") ? NAIL_HEIGHT_MM.thumb : NAIL_HEIGHT_MM.finger;
    return { finger, points: correctForHeight(pixelsToMm(cal, toPoints(n.points)), distance, h), confidence: n.confidence };
  };
  return {
    nails: (scan.nails ?? []).map(convert),
    sideThumb: scan.sideThumb ? convert(scan.sideThumb) : null,
    cameraDistanceMm: distance,
    warnings: cal.warnings,
  };
}

export interface MeasuredScanNail extends NailOutline {
  confidence: number;
  widthMm: number;
  lengthMm: number;
  shape: string;
}

/** What the app shows after one photo: nails in millimetres, or a problem code. */
export interface ScanSummary {
  ok: boolean;
  problem?: ScanProblem;
  nails?: MeasuredScanNail[];
  sideThumb?: MeasuredScanNail | null;
  missing?: string[];
  warnings?: Calibration["warnings"];
  /** Pixel data, only for drawing the outlines over the photo. */
  preview: { width?: number; height?: number; card: [number, number][] | null; nails: ScannedNail[] };
}

/** Turns the scanner's pixel result into what the app shows. Used by the server and the browser. */
export function summariseScan(scan: ScanResult): ScanSummary {
  const preview = { width: scan.width, height: scan.height, card: scan.card ?? null, nails: scan.nails ?? [] };
  if (!scan.ok) return { ok: false, problem: scan.problem ?? "unreadable", preview };
  try {
    const m = measureScan(scan);
    const describe = (n: ScanMeasurement["nails"][number]): MeasuredScanNail => {
      const size = measureNail(n);
      return { ...n, widthMm: size.widthMm, lengthMm: size.lengthMm, shape: size.shape };
    };
    return {
      ok: true,
      nails: m.nails.map(describe),
      sideThumb: m.sideThumb ? describe(m.sideThumb) : null,
      missing: scan.missing ?? [],
      warnings: m.warnings,
      preview,
    };
  } catch {
    return { ok: false, problem: "few-nails", preview };
  }
}
