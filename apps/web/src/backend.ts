/**
 * Where scanning and orders happen. Normally the Naily server; in the "browser" build (hosted as a
 * Claude Artifact, no server) the scanner runs on the phone and orders go to the Artifact's database.
 */
import { priceOrder, summariseScan, validateOrder, type OrderRequest, type ScanStep, type ScanSummary } from "@naily/core";

export const BROWSER_MODE = import.meta.env.VITE_SCANNER === "browser";

export type ScanProgress = { phase: "uploading" | "loading" | "measuring"; fraction: number };

/** Phones can produce huge photos; above this we shrink before uploading (losing EXIF is fine). */
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

async function shrink(file: File, maxSide = 3000): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * s);
  canvas.height = Math.round(bitmap.height * s);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.92));
}

export async function scanPhoto(file: File, step: ScanStep, onProgress: (p: ScanProgress) => void = () => {}): Promise<ScanSummary> {
  const unavailable: ScanSummary = { ok: false, problem: "service-unavailable", preview: { card: null, nails: [] } };
  if (BROWSER_MODE) {
    try {
      const { scanInBrowser } = await import("./scanner/scan.ts");
      return summariseScan(await scanInBrowser(file, step, onProgress));
    } catch (err) {
      console.error("in-browser scan failed", err);
      return unavailable;
    }
  }
  // Send the original when possible: its EXIF tells us the lens, which sharpens the measurement.
  onProgress({ phase: "uploading", fraction: 0 });
  const body = file.size > MAX_UPLOAD_BYTES ? await shrink(file) : file;
  try {
    const res = await fetch(`/api/scan?step=${step}`, { method: "POST", headers: { "content-type": body.type || "image/jpeg" }, body });
    const data = (await res.json()) as ScanSummary;
    return data.ok || data.problem ? data : unavailable;
  } catch {
    return unavailable;
  }
}

function newOrderId(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return "NL-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

interface ArtifactDb {
  doc(path: string): { set(data: Record<string, unknown>): Promise<void> };
}
declare global {
  interface Window {
    claude?: { use(name: string): Promise<unknown> };
  }
}

export type OrderResult = { id: string } | { errors: string[] };

export async function submitOrder(order: OrderRequest): Promise<OrderResult> {
  const errors = validateOrder(order);
  if (errors.length) return { errors };
  if (BROWSER_MODE) {
    const db = (await window.claude?.use("db").catch(() => null)) as ArtifactDb | null;
    if (!db) return { errors: ["Orders can only be placed when you are signed in to claude.ai."] };
    const id = newOrderId();
    try {
      await db.doc(`orders/${id}`).set({
        ...JSON.parse(JSON.stringify(order)),
        price: priceOrder(order.product, order.sets),
        status: "received",
        createdAt: new Date().toISOString(),
      });
      return { id };
    } catch (err) {
      const code = (err as { code?: string }).code;
      return { errors: [code === "invalid_argument" ? "You can view this page but not place orders. Ask the owner for Contributor access." : "Could not save the order. Please try again."] };
    }
  }
  try {
    const res = await fetch("/api/orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(order) });
    const body = await res.json();
    return res.ok ? { id: body.id } : { errors: body.errors ?? [body.error ?? `Error ${res.status}`] };
  } catch {
    return { errors: ["Network error, please try again."] };
  }
}
