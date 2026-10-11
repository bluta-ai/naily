import {
  calibrateFromCard,
  completeHandSet,
  pixelsToMm,
  type Calibration,
  type FingerId,
  type NailOutline,
  type Point,
} from "@naily/core";

export interface PhotoNail {
  finger: FingerId;
  /** Control points in image pixels. */
  points: Point[];
}

export interface Photo {
  id: string;
  url: string;
  width: number;
  height: number;
  /** Card corners in image pixels, once the customer has placed them. */
  card: Point[] | null;
  nails: PhotoNail[];
}

export function calibrationFor(photo: Photo): Calibration | null {
  if (!photo.card) return null;
  try {
    return calibrateFromCard(photo.card);
  } catch {
    return null;
  }
}

/** All scanned nails converted to millimetres, plus mirrored stand-ins for unscanned fingers. */
export function collectOutlines(photos: Photo[]): { scanned: NailOutline[]; complete: NailOutline[] } {
  const scanned: NailOutline[] = [];
  for (const photo of photos) {
    const cal = calibrationFor(photo);
    if (!cal) continue;
    for (const n of photo.nails) scanned.push({ finger: n.finger, points: pixelsToMm(cal, n.points) });
  }
  return { scanned, complete: completeHandSet(scanned) };
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

/** Loads a photo, downscaled so marking stays smooth on phones. */
export async function loadPhoto(blob: Blob, maxSide = 2000): Promise<Photo> {
  const bitmap = await createImageBitmap(blob);
  const s = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * s);
  const height = Math.round(bitmap.height * s);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const out = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode photo"))), "image/jpeg", 0.9),
  );
  return { id: Math.random().toString(36).slice(2), url: URL.createObjectURL(out), width, height, card: null, nails: [] };
}
