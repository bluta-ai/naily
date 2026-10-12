import { completeHandSet, FINGERS, isFingerId, type FingerId, type NailOutline, type ScanStep, type ScanSummary } from "@naily/core";

export type ScanResponse = ScanSummary;
export type StepResults = Partial<Record<ScanStep, ScanSummary>>;

/**
 * Combines the four photos into 10 nails. A thumb seen side-on on the flat-hand photo is used
 * only when its own thumb photo was skipped; anything still missing is mirrored from the other hand.
 */
export function collectNails(results: StepResults): { nails: NailOutline[]; missing: FingerId[] } {
  const byFinger = new Map<FingerId, NailOutline>();
  for (const step of ["left-hand", "right-hand", "left-thumb", "right-thumb"] as ScanStep[]) {
    for (const n of results[step]?.nails ?? []) if (isFingerId(n.finger)) byFinger.set(n.finger, { finger: n.finger, points: n.points });
  }
  for (const step of ["left-hand", "right-hand"] as ScanStep[]) {
    const side = results[step]?.sideThumb;
    if (side && isFingerId(side.finger) && !byFinger.has(side.finger)) byFinger.set(side.finger, { finger: side.finger, points: side.points });
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
