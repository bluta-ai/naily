import { bounds, offsetPolygon, toPathData } from "./geometry.ts";
import { FINGERS, type FingerId, type NailMeasurement } from "./nail.ts";
import { getPattern, type PatternParams } from "./patterns.ts";

export interface PatternChoice {
  patternId: string;
  params: PatternParams;
}

export interface Design {
  main: PatternChoice;
  /** Optional accent pattern, e.g. on both ring fingers. */
  accent?: PatternChoice & { fingers: FingerId[] };
}

export function choiceFor(design: Design, finger: FingerId): PatternChoice {
  return design.accent?.fingers.includes(finger) ? design.accent : design.main;
}

const seedFor = (finger: FingerId) => FINGERS.indexOf(finger) * 7919 + 17;

/**
 * SVG group for one nail, drawn in its own frame (tip at the top, millimetres).
 * `insetMm` shrinks the printed artwork so it sits just inside the cuticle and side walls.
 */
export function renderNail(
  nail: NailMeasurement,
  design: Design,
  opts: { uid: string; insetMm?: number; /** Stroke colour for the outline, e.g. red cut lines for the cutter. */ outline?: string } = { uid: "n" },
): string {
  const choice = choiceFor(design, nail.finger);
  const pattern = getPattern(choice.patternId);
  if (!pattern) throw new Error(`Unknown pattern "${choice.patternId}"`);
  const shape = opts.insetMm ? offsetPolygon(nail.outline, -opts.insetMm) : nail.outline;
  const path = toPathData(shape);
  const clipId = `${opts.uid}-clip`;
  const art = pattern.render(choice.params as Required<PatternParams>, {
    width: nail.widthMm,
    height: nail.lengthMm,
    uid: opts.uid,
    seed: seedFor(nail.finger),
  });
  return (
    `<g>` +
    `<clipPath id="${clipId}"><path d="${path}"/></clipPath>` +
    `<g clip-path="url(#${clipId})">${art}</g>` +
    (opts.outline ? `<path d="${path}" fill="none" stroke="${opts.outline}" stroke-width="0.1"/>` : "") +
    `</g>`
  );
}

export interface SheetOptions {
  /** Shrink applied to every nail so the wrap never touches skin. */
  insetMm?: number;
  gapMm?: number;
  marginMm?: number;
  cutLines?: boolean;
  labels?: boolean;
  title?: string;
}

/**
 * Print-ready sheet at true physical scale (the SVG's width/height are in mm).
 * Left hand on the top row, right hand underneath, thumb to pinky.
 */
export function renderSheet(nails: NailMeasurement[], design: Design, options: SheetOptions = {}): string {
  const { insetMm = 0.3, gapMm = 4, marginMm = 8, cutLines = true, labels = true, title } = options;
  const rows: NailMeasurement[][] = [
    nails.filter((n) => n.finger.startsWith("L")),
    nails.filter((n) => n.finger.startsWith("R")),
  ].filter((r) => r.length > 0);
  const labelH = labels ? 4 : 0;
  const titleH = title ? 8 : 0;

  let y = marginMm + titleH;
  let sheetW = 0;
  let body = "";
  for (const row of rows) {
    let x = marginMm;
    const rowH = Math.max(...row.map((n) => n.lengthMm));
    for (const nail of row) {
      const uid = `nail-${nail.finger}`;
      body += `<g transform="translate(${x.toFixed(2)} ${y.toFixed(2)})">`;
      body += renderNail(nail, design, { uid, insetMm, outline: cutLines ? "#ff0000" : undefined });
      if (labels) {
        const b = bounds(nail.outline);
        body +=
          `<text x="${((b.maxX - b.minX) / 2).toFixed(2)}" y="${(rowH + 3).toFixed(2)}" ` +
          `font-size="2.4" font-family="sans-serif" text-anchor="middle" fill="#555">` +
          `${nail.finger} · ${nail.widthMm.toFixed(1)}mm${nail.estimated ? "*" : ""}</text>`;
      }
      body += `</g>`;
      x += Math.max(nail.widthMm, 12) + gapMm;
    }
    sheetW = Math.max(sheetW, x - gapMm + marginMm);
    y += rowH + labelH + gapMm;
  }
  const sheetH = y - gapMm + marginMm;
  const header = title
    ? `<text x="${marginMm}" y="${marginMm + 4}" font-size="4" font-family="sans-serif" fill="#222">${escapeXml(title)}</text>`
    : "";
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sheetW.toFixed(2)}mm" height="${sheetH.toFixed(2)}mm" ` +
    `viewBox="0 0 ${sheetW.toFixed(2)} ${sheetH.toFixed(2)}">` +
    `<rect width="100%" height="100%" fill="#ffffff"/>${header}${body}</svg>`
  );
}

export function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

/**
 * The finger's artwork as a standalone SVG, unclipped, `widthMm` × `lengthMm` with the tip at the
 * top. Used to paint the design onto the customer's own photo (the photo's nail outline clips it).
 */
export function renderArtwork(design: Design, finger: FingerId, widthMm: number, lengthMm: number, pxPerMm = 20): string {
  const choice = choiceFor(design, finger);
  const pattern = getPattern(choice.patternId);
  if (!pattern) throw new Error(`Unknown pattern "${choice.patternId}"`);
  const art = pattern.render(choice.params as Required<PatternParams>, {
    width: widthMm,
    height: lengthMm,
    uid: `art-${finger}`,
    seed: seedFor(finger),
  });
  const w = widthMm.toFixed(2);
  const h = lengthMm.toFixed(2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" ` +
    `width="${Math.round(widthMm * pxPerMm)}" height="${Math.round(lengthMm * pxPerMm)}">${art}</svg>`
  );
}
