import { useEffect, useRef, useState } from "react";
import { isFingerId, renderArtwork, type Design, type ScanStep, type ScanSummary } from "@naily/core";
import { useI18n } from "../i18n.ts";

interface Props {
  design: Design;
  /** The customer's own photos from this visit, with the scan results that located each nail. */
  shots: { step: ScanStep; file: File; result: ScanSummary }[];
}

type Pt = [number, number];

/**
 * Paints the chosen design onto the nails in the customer's own photo. Each nail's outline and
 * direction come from the scan, so the artwork follows the real nail; the photo's own light and
 * shine are blended back on top so it reads as polish rather than a sticker.
 */
export function TryOn({ design, shots }: Props) {
  const { t } = useI18n();
  const usable = shots.filter((s) => s.result.ok && s.result.preview.width && (s.result.preview.nails?.length ?? 0) > 0);
  const [index, setIndex] = useState(0);
  const shot = usable[Math.min(index, usable.length - 1)];
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [bitmap, setBitmap] = useState<{ file: File; img: ImageBitmap } | null>(null);

  useEffect(() => {
    if (!shot || bitmap?.file === shot.file) return;
    let cancelled = false;
    const { width, height } = shot.result.preview;
    createImageBitmap(shot.file, { imageOrientation: "from-image" })
      .then((b) => createImageBitmap(b, { resizeWidth: width!, resizeHeight: height!, resizeQuality: "high" }))
      .then((img) => !cancelled && setBitmap({ file: shot.file, img }))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [shot, bitmap]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !shot || !bitmap || bitmap.file !== shot.file) return;
    paint(canvas, bitmap.img, shot.result, design).catch(() => {});
  }, [shot, bitmap, design]);

  if (!usable.length) return null;
  return (
    <div className="try-on">
      <h2>{t.onYourHand}</h2>
      {usable.length > 1 && (
        <div className="tabs" role="tablist">
          {usable.map((s, i) => (
            <button key={s.step} role="tab" aria-selected={s === shot} className={s === shot ? "active" : ""} onClick={() => setIndex(i)}>
              {t.steps[s.step].title}
            </button>
          ))}
        </div>
      )}
      <canvas ref={canvasRef} className="try-on-canvas" aria-label={t.onYourHand} />
      <p className="muted">{t.tryOnNote}</p>
    </div>
  );
}

const loadSvg = (svg: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  });

async function paint(canvas: HTMLCanvasElement, photo: ImageBitmap, result: ScanSummary, design: Design) {
  const { width, height, nails } = result.preview;
  const w = width!;
  const h = height!;
  // Crop to the fingers so the nails are big enough to see on a phone.
  const all = nails.flatMap((n) => n.points);
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pad = span * 0.45;
  const x0 = Math.max(0, Math.min(...xs) - pad);
  const y0 = Math.max(0, Math.min(...ys) - pad);
  const x1 = Math.min(w, Math.max(...xs) + pad);
  const y1 = Math.min(h, Math.max(...ys) + pad);

  // Prepare artwork first, then draw everything in one go (no half-painted frames).
  const arts = await Promise.all(
    nails.map(async (n) => {
      if (!isFingerId(n.finger)) return null;
      const mm = result.nails?.find((m) => m.finger === n.finger);
      if (!mm) return null;
      const pts = n.points as Pt[];
      const tip = pts[0]!;
      const cut = pts[pts.length / 2]!;
      const len = Math.hypot(tip[0] - cut[0], tip[1] - cut[1]);
      const u: Pt = [(tip[0] - cut[0]) / len, (tip[1] - cut[1]) / len]; // towards the free edge
      const v: Pt = [-u[1], u[0]];
      // The nail's own frame (same as @naily/core toNailFrame): x across, y from tip to cuticle.
      const lx = pts.map((p) => p[0] * v[0] + p[1] * v[1]);
      const ly = pts.map((p) => -(p[0] * u[0] + p[1] * u[1]));
      const minX = Math.min(...lx);
      const minY = Math.min(...ly);
      const k = (Math.max(...lx) - minX) / mm.widthMm; // pixels per mm along this nail
      const img = await loadSvg(renderArtwork(design, n.finger, mm.widthMm, mm.lengthMm));
      return { pts, u, v, minX, minY, k, mm, img };
    }),
  );

  canvas.width = Math.round(x1 - x0);
  canvas.height = Math.round(y1 - y0);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, -x0, -y0);
  ctx.drawImage(photo, 0, 0);

  const shine = shineLayer(photo);
  for (const a of arts) {
    if (!a) continue;
    ctx.save();
    ctx.beginPath();
    a.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    // Nail frame (mm) → photo pixels: p = (x·k + minX)·v − (y·k + minY)·u, shifted for the crop.
    const { u, v, k, minX, minY } = a;
    ctx.setTransform(v[0] * k, v[1] * k, -u[0] * k, -u[1] * k, minX * v[0] - minY * u[0] - x0, minX * v[1] - minY * u[1] - y0);
    ctx.drawImage(a.img, 0, 0, a.mm.widthMm, a.mm.lengthMm);
    // Bring back the nail's own light: highlights and curvature from the photo.
    ctx.setTransform(1, 0, 0, 1, -x0, -y0);
    ctx.globalCompositeOperation = "soft-light";
    ctx.globalAlpha = 0.55;
    ctx.drawImage(shine, 0, 0);
    ctx.restore();
  }
}

const shineCache = new WeakMap<ImageBitmap, HTMLCanvasElement>();

/** A greyscale, contrast-stretched copy of the photo used to keep the nails' highlights. */
function shineLayer(photo: ImageBitmap): HTMLCanvasElement {
  const cached = shineCache.get(photo);
  if (cached) return cached;
  const c = document.createElement("canvas");
  c.width = photo.width;
  c.height = photo.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(photo, 0, 0);
  const d = ctx.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i]! + 0.587 * px[i + 1]! + 0.114 * px[i + 2]!;
    const g = Math.max(0, Math.min(255, (l - 128) * 1.6 + 128));
    px[i] = px[i + 1] = px[i + 2] = g;
  }
  ctx.putImageData(d, 0, 0);
  shineCache.set(photo, c);
  return c;
}
