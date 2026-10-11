import { useId } from "react";
import { renderNail, type Design, type NailMeasurement } from "@naily/core";

/** Both hands at true relative scale, rendered by the same code that makes the factory file. */
export function NailPreview({ nails, design }: { nails: NailMeasurement[]; design: Design }) {
  // Several previews share the page; SVG clip-path ids must not collide between them.
  const prefix = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gap = 3;
  const rows = [nails.filter((n) => n.finger[0] === "L"), nails.filter((n) => n.finger[0] === "R")];
  let y = 0;
  let width = 0;
  let markup = "";
  rows.forEach((row) => {
    let x = 0;
    for (const n of row) {
      markup += `<g transform="translate(${x} ${y})">${renderNail(n, design, { uid: `pv${prefix}-${n.finger}`, outline: "#00000033" })}</g>`;
      x += n.widthMm + gap;
    }
    width = Math.max(width, x - gap);
    y += Math.max(0, ...row.map((n) => n.lengthMm)) + gap * 2;
  });
  const height = Math.max(1, y - gap * 2);
  return (
    <svg
      className="preview"
      viewBox={`-1 -1 ${width + 2} ${height + 2}`}
      style={{ aspectRatio: `${width + 2} / ${height + 2}` }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}

/** Left hand pinky→thumb then right hand thumb→pinky: how the customer sees their hands palm-down. */
export function orderForDisplay(nails: NailMeasurement[]): NailMeasurement[] {
  const left = nails.filter((n) => n.finger[0] === "L").sort((a, b) => b.finger.localeCompare(a.finger));
  const right = nails.filter((n) => n.finger[0] === "R").sort((a, b) => a.finger.localeCompare(b.finger));
  return [...left, ...right];
}
