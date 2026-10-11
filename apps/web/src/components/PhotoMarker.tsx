import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  catmullRomClosed,
  CUTICLE_INDEX,
  defaultOutline,
  FINGERS,
  measureNail,
  pixelsToMm,
  REFERENCE_CARD,
  toPathData,
  type FingerId,
  type Point,
} from "@naily/core";
import { useI18n } from "../i18n.ts";
import { calibrationFor, type Photo, type PhotoNail } from "../state.ts";
import { FingerLabel } from "./FingerLabel.tsx";

interface Props {
  photo: Photo;
  /** Fingers already marked on any photo. */
  placed: Set<FingerId>;
  onChange(photo: Photo): void;
  onPlaceNail(photoId: string, nail: PhotoNail): void;
}

type Drag = { kind: "card"; index: number } | { kind: "nail"; finger: FingerId; index: number };

const LOUPE_ZOOM = 4;

function initialCard(photo: Photo): Point[] {
  const w = photo.width * 0.4;
  const h = (w * REFERENCE_CARD.heightMm) / REFERENCE_CARD.widthMm;
  const cx = photo.width / 2;
  const cy = photo.height * 0.75;
  return [
    { x: cx - w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy - h / 2 },
    { x: cx + w / 2, y: cy + h / 2 },
    { x: cx - w / 2, y: cy + h / 2 },
  ];
}

export function PhotoMarker({ photo, placed, onChange, onPlaceNail }: Props) {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const [mode, setMode] = useState<"card" | "nails">(photo.card ? "nails" : "card");
  const [finger, setFinger] = useState<FingerId | null>(() => FINGERS.find((f) => !placed.has(f)) ?? null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [cursor, setCursor] = useState<Point | null>(null);

  const card = useMemo(() => photo.card ?? initialCard(photo), [photo]);
  const cal = useMemo(() => calibrationFor({ ...photo, card }), [photo, card]);
  const unit = Math.max(photo.width, photo.height) / 110;
  const selected = photo.nails.find((n) => n.finger === finger);

  const measurement = useMemo(() => {
    if (!cal || !selected) return null;
    try {
      return measureNail({ finger: selected.finger, points: pixelsToMm(cal, selected.points) });
    } catch {
      return null;
    }
  }, [cal, selected]);

  function toImage(e: ReactPointerEvent): Point {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: Math.min(photo.width, Math.max(0, p.x)), y: Math.min(photo.height, Math.max(0, p.y)) };
  }

  function startDrag(e: ReactPointerEvent, d: Drag) {
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    setDrag(d);
    setCursor(toImage(e));
  }

  function move(e: ReactPointerEvent) {
    if (!drag) return;
    const p = toImage(e);
    setCursor(p);
    if (drag.kind === "card") {
      const next = card.slice();
      next[drag.index] = p;
      onChange({ ...photo, card: next });
    } else {
      onChange({
        ...photo,
        nails: photo.nails.map((n) =>
          n.finger === drag.finger ? { ...n, points: n.points.map((q, i) => (i === drag.index ? p : q)) } : n,
        ),
      });
    }
  }

  function endDrag() {
    setDrag(null);
    setCursor(null);
  }

  function tapBackground(e: ReactPointerEvent) {
    if (mode !== "nails" || !finger || !cal || photo.nails.some((n) => n.finger === finger)) return;
    const c = toImage(e);
    const isThumb = finger.endsWith("1");
    const pxPerMm = 1 / cal.mmPerPixel;
    const points = defaultOutline(c, (isThumb ? 15 : 11) * pxPerMm, (isThumb ? 15 : 12) * pxPerMm);
    onPlaceNail(photo.id, { finger, points });
  }

  function confirmCard() {
    onChange({ ...photo, card });
    setMode("nails");
  }

  function deleteNail() {
    if (!finger) return;
    onChange({ ...photo, nails: photo.nails.filter((n) => n.finger !== finger) });
  }

  const scene = (forLoupe: boolean): ReactNode => (
    <>
      <image href={photo.url} width={photo.width} height={photo.height} />
      <polygon
        points={card.map((p) => `${p.x},${p.y}`).join(" ")}
        fill={mode === "card" ? "rgba(33,150,243,0.15)" : "none"}
        stroke="#2196f3"
        strokeWidth={unit * 0.25}
      />
      {photo.nails.map((n) => {
        const active = n.finger === finger && mode === "nails";
        return (
          <g key={n.finger}>
            <path
              d={toPathData(catmullRomClosed(n.points))}
              fill={active ? "rgba(236,64,122,0.18)" : "rgba(255,255,255,0.08)"}
              stroke={active ? "#ec407a" : "#fff"}
              strokeWidth={unit * (active ? 0.3 : 0.2)}
              onPointerDown={(e) => {
                if (mode !== "nails" || forLoupe) return;
                e.stopPropagation();
                setFinger(n.finger);
              }}
            />
            {!forLoupe && !active && (
              <text
                x={n.points[CUTICLE_INDEX]!.x}
                y={n.points[CUTICLE_INDEX]!.y + unit * 2.2}
                fontSize={unit * 1.6}
                textAnchor="middle"
                fill="#fff"
                stroke="#000"
                strokeWidth={unit * 0.08}
              >
                {n.finger}
              </text>
            )}
          </g>
        );
      })}
      {mode === "card" &&
        card.map((p, i) => (
          <Handle key={i} p={p} r={unit} fill="#2196f3" loupe={forLoupe} onDown={(e) => startDrag(e, { kind: "card", index: i })} />
        ))}
      {mode === "nails" &&
        selected?.points.map((p, i) => (
          <Handle
            key={i}
            p={p}
            r={unit * (forLoupe ? 0.5 : 0.8)}
            fill={i === 0 ? "#ec407a" : i === CUTICLE_INDEX ? "#ffffff" : "rgba(236,64,122,0.35)"}
            loupe={forLoupe}
            onDown={(e) => startDrag(e, { kind: "nail", finger: selected.finger, index: i })}
          />
        ))}
    </>
  );

  const loupeSize = Math.max(photo.width, photo.height) / LOUPE_ZOOM / 4;

  return (
    <div className="marker">
      <p className="hint">{mode === "card" ? t.markCard : t.markNails}</p>

      {mode === "nails" && (
        <div className="fingers">
          {FINGERS.map((f) => (
            <button
              key={f}
              className={`chip ${f === finger ? "active" : ""} ${placed.has(f) ? "done" : ""}`}
              onClick={() => setFinger(f)}
            >
              <FingerLabel finger={f} short />
            </button>
          ))}
        </div>
      )}

      <div className="stage">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${photo.width} ${photo.height}`}
          onPointerDown={tapBackground}
          onPointerMove={move}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {scene(false)}
        </svg>
        {cursor && (
          <svg
            className="loupe"
            viewBox={`${cursor.x - loupeSize / 2} ${cursor.y - loupeSize / 2} ${loupeSize} ${loupeSize}`}
            aria-hidden
          >
            {scene(true)}
            <circle cx={cursor.x} cy={cursor.y} r={loupeSize / 40} fill="none" stroke="#ff0" strokeWidth={loupeSize / 200} />
          </svg>
        )}
      </div>

      <div className="row">
        {mode === "card" ? (
          <button className="primary" onClick={confirmCard} disabled={!cal}>
            {t.cardDone}
          </button>
        ) : (
          <>
            <button onClick={() => setMode("card")}>{t.editCard}</button>
            {selected && <button onClick={deleteNail}>{t.deleteNail}</button>}
          </>
        )}
      </div>

      {cal && cal.warnings.length > 0 && (
        <ul className="warn">
          {cal.warnings.map((w) => (
            <li key={w}>{t.warnings[w]}</li>
          ))}
        </ul>
      )}

      {measurement && (
        <p className="measure">
          <FingerLabel finger={measurement.finger} /> · {t.width} {measurement.widthMm.toFixed(1)} {t.mm} · {t.length}{" "}
          {measurement.lengthMm.toFixed(1)} {t.mm} · {t.shapes[measurement.shape]}
        </p>
      )}
    </div>
  );
}

function Handle({ p, r, fill, loupe, onDown }: { p: Point; r: number; fill: string; loupe: boolean; onDown(e: ReactPointerEvent): void }) {
  return (
    <g>
      <circle cx={p.x} cy={p.y} r={r} fill={fill} stroke="#000" strokeWidth={r * 0.15} pointerEvents="none" />
      {/* A larger invisible hit target so fingertips can grab the dot on a phone. */}
      {!loupe && <circle cx={p.x} cy={p.y} r={r * 2.4} fill="transparent" style={{ cursor: "grab" }} onPointerDown={onDown} />}
    </g>
  );
}
