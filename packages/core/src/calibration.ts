import { dist, isConvex, signedArea, type Point } from "./geometry.ts";
import { applyHomography, computeHomography, invertMatrix3, type Matrix3 } from "./homography.ts";

/**
 * ISO/IEC 7810 ID-1: every bank card, transit card and ID card in the world.
 * It is the scale reference the customer puts next to their hand.
 */
export const REFERENCE_CARD = { widthMm: 85.6, heightMm: 53.98 } as const;

export type CalibrationWarning = "not-convex" | "too-small" | "strong-perspective" | "aspect-mismatch";

export interface Calibration {
  /** Maps image pixels onto the flat table plane, in millimetres. */
  imageToMm: Matrix3;
  mmToImage: Matrix3;
  /** Approximate scale at the card's centre — handy for sizing default UI elements. */
  mmPerPixel: number;
  warnings: CalibrationWarning[];
}

/**
 * Builds a pixel→millimetre mapping from the four corners of a reference card in the photo.
 * Corners may be given in any rotational order, clockwise or not, and the card may be
 * landscape or portrait: the long edges are detected from the quad itself.
 */
export function calibrateFromCard(cornersPx: Point[]): Calibration {
  if (cornersPx.length !== 4) throw new Error("Need exactly 4 card corners");
  const [p0, p1, p2, p3] = cornersPx as [Point, Point, Point, Point];
  const warnings: CalibrationWarning[] = [];
  if (!isConvex(cornersPx)) warnings.push("not-convex");

  const e01 = dist(p0, p1);
  const e12 = dist(p1, p2);
  const e23 = dist(p2, p3);
  const e30 = dist(p3, p0);
  const longFirst = e01 + e23 >= e12 + e30;
  const W = REFERENCE_CARD.widthMm;
  const H = REFERENCE_CARD.heightMm;
  let dst: Point[] = longFirst
    ? [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }]
    : [{ x: 0, y: 0 }, { x: H, y: 0 }, { x: H, y: W }, { x: 0, y: W }];
  // Keep the same winding as the photo so the mapping is a rotation, never a mirror image.
  if (Math.sign(signedArea(cornersPx)) !== Math.sign(signedArea(dst))) {
    dst = dst.map((p) => ({ x: p.y, y: p.x }));
  }

  const imageToMm = computeHomography(cornersPx, dst);
  const mmToImage = invertMatrix3(imageToMm);

  const centre = applyHomography(mmToImage, longFirst ? { x: W / 2, y: H / 2 } : { x: H / 2, y: W / 2 });
  const a = applyHomography(imageToMm, centre);
  const b = applyHomography(imageToMm, { x: centre.x + 1, y: centre.y });
  const c = applyHomography(imageToMm, { x: centre.x, y: centre.y + 1 });
  const mmPerPixel = (dist(a, b) + dist(a, c)) / 2;

  const pxArea = Math.abs(signedArea(cornersPx));
  if (pxArea < 2500) warnings.push("too-small");
  const longSides = longFirst ? [e01, e23] : [e12, e30];
  const shortSides = longFirst ? [e12, e30] : [e01, e23];
  const ratio = (longSides[0]! + longSides[1]!) / (shortSides[0]! + shortSides[1]!);
  if (Math.abs(ratio - W / H) / (W / H) > 0.25) warnings.push("aspect-mismatch");
  const skew = Math.max(
    Math.abs(longSides[0]! - longSides[1]!) / Math.max(...longSides),
    Math.abs(shortSides[0]! - shortSides[1]!) / Math.max(...shortSides),
  );
  if (skew > 0.2) warnings.push("strong-perspective");

  return { imageToMm, mmToImage, mmPerPixel, warnings };
}

export const pixelsToMm = (cal: Calibration, pts: Point[]): Point[] =>
  pts.map((p) => applyHomography(cal.imageToMm, p));
