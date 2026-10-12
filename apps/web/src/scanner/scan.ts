/** One photo in, card corners and nail outlines out: the browser twin of apps/vision/naily_vision/scan.py. */
import type { ScanResult, ScanStep } from "@naily/core";
import { detectCard, samCandidates, type Pt } from "./card.ts";
import { loadPhoto } from "./image.ts";
import { detectHands, findNails, isBackOfHand, isBlurry, resampleOutline, samDecode, samEmbed, type SamEmbedding } from "./nails.ts";
import { loadRuntime } from "./runtime.ts";

const MIN_CONFIDENCE = 0.6;
const round2 = (p: Pt): [number, number] => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];

export interface ScanProgress {
  phase: "loading" | "measuring";
  fraction: number;
}

export async function scanInBrowser(file: Blob, step: ScanStep, onProgress: (p: ScanProgress) => void = () => {}): Promise<ScanResult> {
  const rt = await loadRuntime((fraction) => onProgress({ phase: "loading", fraction }));
  const { cv } = rt;
  onProgress({ phase: "measuring", fraction: 0.05 });

  let photo;
  try {
    photo = await loadPhoto(file);
  } catch {
    return { ok: false, problem: "unreadable" };
  }
  const { width: w, height: h } = photo;
  const base = { width: w, height: h, focal35: photo.focal35 };
  const side = step.startsWith("left") ? "L" : "R";
  const thumbStep = step.endsWith("thumb");
  const img = cv.matFromArray(h, w, cv.CV_8UC3, photo.rgb);
  try {
    const hands = detectHands(rt, photo.rgb, w, h);
    onProgress({ phase: "measuring", fraction: 0.15 });

    // SAM fallback for the card: encode the whole photo once, decode at the 1024px working size.
    let embedding: SamEmbedding | null = null;
    let decodeSize: [number, number] = [h, w];
    const segments: { points: Pt[]; masks: Uint8Array[]; scores: number[] }[] = [];
    // Decoding is async, so the grid is decoded ahead of time and looked up by the search.
    const samFallback = () =>
      samCandidates(
        cv,
        (points) => {
          const hit = segments.find((sg) => sg.points[0]![0] === points[0]![0] && sg.points[0]![1] === points[0]![1]);
          return { masks: hit?.masks ?? [], scores: hit?.scores ?? [], width: decodeSize[1], height: decodeSize[0], scale: decodeSize[1] / w };
        },
        hands.flatMap((hd) => hd.landmarks),
        w,
        h,
      );
    let card = detectCard(cv, img, hands.flatMap((hd) => hd.landmarks));
    if (!card) {
      embedding = await samEmbed(rt, img);
      decodeSize = [Math.round(h * embedding.scale), Math.round(w * embedding.scale)];
      const local = { ...embedding, scale: 1 }; // grid points are given in the decode frame below
      for (let gy = 0; gy < 8; gy++) {
        for (let gx = 0; gx < 10; gx++) {
          const x = (0.06 + (0.88 * gx) / 9) * w;
          const y = (0.08 + (0.84 * gy) / 7) * h;
          const r = await samDecode(rt, local, decodeSize, [[x * embedding.scale, y * embedding.scale]], [1]);
          segments.push({ points: [[x, y]], ...r });
        }
      }
      card = detectCard(cv, img, hands.flatMap((hd) => hd.landmarks), samFallback);
    }
    onProgress({ phase: "measuring", fraction: 0.3 });
    if (!card) return { ...base, ok: false, problem: "no-card" };
    const cardPx = card.map(round2);
    const cardWidth = Math.max(...card.map((p, i) => Math.hypot(card![(i + 1) % 4]![0] - p[0], card![(i + 1) % 4]![1] - p[1])));
    if (cardWidth < 0.12 * Math.max(w, h)) return { ...base, ok: false, problem: "card-too-small", card: cardPx };
    if (!hands.length) return { ...base, ok: false, problem: "no-hand", card: cardPx };

    const cx = card.reduce((s, p) => s + p[0], 0) / 4;
    const cy = card.reduce((s, p) => s + p[1], 0) / 4;
    const centreOf = (pts: Pt[]) => [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
    const hand = hands.reduce((a, b) => {
      const [ax, ay] = centreOf(a.landmarks);
      const [bx, by] = centreOf(b.landmarks);
      return Math.hypot(bx! - cx, by! - cy) < Math.hypot(ax! - cx, ay! - cy) ? b : a;
    });

    let done = 0;
    const wanted = thumbStep ? [1] : [2, 3, 4, 5];
    const nails = await findNails(rt, img, hand, wanted, () =>
      onProgress({ phase: "measuring", fraction: 0.35 + 0.6 * (++done / wanted.length) }),
    );
    const good = new Map([...nails].filter(([f, n]) => wanted.includes(f) && n.confidence >= MIN_CONFIDENCE));

    if (!thumbStep && !isBackOfHand(hand, side)) {
      return { ...base, ok: false, problem: good.size >= 3 ? "wrong-hand" : "palm", card: cardPx };
    }
    if (!good.size || (!thumbStep && good.size < 3)) {
      let problem: ScanResult["problem"] = "few-nails";
      if (isBlurry(cv, img, hand)) problem = "blurry";
      else if (!thumbStep && !wanted.some((f) => nails.has(f))) problem = "palm";
      return { ...base, ok: false, problem, card: cardPx };
    }
    const toOut = (f: number) => {
      const n = nails.get(f)!;
      return { finger: `${side}${f}`, points: resampleOutline(n.contour, n.tip, 32).map(round2), confidence: Math.round(n.confidence * 1000) / 1000 };
    };
    return {
      ...base,
      ok: true,
      card: cardPx,
      nails: [...good.keys()].sort().map(toOut),
      // Only the photographed fingers are traced here (to save time on phones), so no side-on thumb.
      sideThumb: null,
      missing: wanted.filter((f) => !good.has(f)).map((f) => `${side}${f}`),
    };
  } finally {
    img.delete();
    onProgress({ phase: "measuring", fraction: 1 });
  }
}
