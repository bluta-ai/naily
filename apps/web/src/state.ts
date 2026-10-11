import { completeHandSet, FINGERS, type FingerId, type NailOutline, type ScanProblem, type ScanStep } from "@naily/core";

export interface ScannedNail extends NailOutline {
  confidence: number;
  widthMm: number;
  lengthMm: number;
  shape: string;
}

/** What /api/scan answers. Pixel data in `preview` is only for drawing the outlines on the photo. */
export interface ScanResponse {
  ok: boolean;
  problem?: ScanProblem;
  nails?: ScannedNail[];
  sideThumb?: ScannedNail | null;
  missing?: FingerId[];
  preview?: {
    width?: number;
    height?: number;
    card: [number, number][] | null;
    nails: { finger: string; points: [number, number][] }[];
  };
}

export type StepResults = Partial<Record<ScanStep, ScanResponse>>;

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
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.92),
  );
}

export async function scanPhoto(file: File, step: ScanStep): Promise<ScanResponse> {
  // Send the original when possible: its EXIF tells us the lens, which sharpens the measurement.
  const body = file.size > MAX_UPLOAD_BYTES ? await shrink(file) : file;
  try {
    const res = await fetch(`/api/scan?step=${step}`, {
      method: "POST",
      headers: { "content-type": body.type || "image/jpeg" },
      body,
    });
    const data = (await res.json()) as ScanResponse;
    return data.ok || data.problem ? data : { ok: false, problem: "service-unavailable" };
  } catch {
    return { ok: false, problem: "service-unavailable" };
  }
}

/**
 * Combines the four photos into 10 nails. A thumb seen side-on on the flat-hand photo is used
 * only when its own thumb photo was skipped; anything still missing is mirrored from the other hand.
 */
export function collectNails(results: StepResults): { nails: NailOutline[]; missing: FingerId[] } {
  const byFinger = new Map<FingerId, NailOutline>();
  for (const step of ["left-hand", "right-hand", "left-thumb", "right-thumb"] as ScanStep[]) {
    for (const n of results[step]?.nails ?? []) byFinger.set(n.finger, { finger: n.finger, points: n.points });
  }
  for (const step of ["left-hand", "right-hand"] as ScanStep[]) {
    const side = results[step]?.sideThumb;
    if (side && !byFinger.has(side.finger)) byFinger.set(side.finger, { finger: side.finger, points: side.points });
  }
  const nails = completeHandSet([...byFinger.values()]);
  const have = new Set(nails.map((n) => n.finger));
  return { nails, missing: FINGERS.filter((f) => !have.has(f)) };
}

const PROFILE_KEY = "naily.profile.v1";

export function saveProfile(nails: NailOutline[]) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ savedAt: Date.now(), nails }));
  } catch {
    // Private mode or storage full: the profile is a convenience only.
  }
}

export function loadProfile(): NailOutline[] | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { nails?: NailOutline[] };
    return Array.isArray(parsed.nails) && parsed.nails.length === 10 ? parsed.nails : null;
  } catch {
    return null;
  }
}
