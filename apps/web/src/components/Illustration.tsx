import type { ScanStep } from "@naily/core";

/** Simple pictures of what each photo should look like. Right-hand steps are mirrored. */
export function Illustration({ step }: { step: ScanStep }) {
  const right = step.startsWith("right");
  const thumb = step.endsWith("thumb");
  return (
    <svg className="illustration" viewBox="0 0 320 220" role="img" aria-hidden>
      <rect width="320" height="220" rx="18" fill="#f6efe9" />
      <g transform={right ? "translate(320 0) scale(-1 1)" : undefined}>{thumb ? <Thumb /> : <Hand />}</g>
      <Card x={right ? 30 : 200} y={thumb ? 120 : 130} />
    </svg>
  );
}

const SKIN = "#f1c7a8";
const SKIN_EDGE = "#c98f6d";
const NAIL = "#f7a1b8";

function Hand() {
  // Left hand, back up, fingers pointing away from the viewer; the thumb is on the right.
  const fingers = [
    { x: 46, y: 28, h: 92 },
    { x: 76, y: 14, h: 104 },
    { x: 106, y: 20, h: 98 },
    { x: 136, y: 40, h: 80 },
  ];
  return (
    <g stroke={SKIN_EDGE} strokeWidth="2">
      {fingers.map((f) => (
        <g key={f.x}>
          <rect x={f.x} y={f.y} width="26" height={f.h + 40} rx="13" fill={SKIN} />
          <rect x={f.x + 5} y={f.y + 5} width="16" height="20" rx="8" fill={NAIL} stroke="none" />
        </g>
      ))}
      <path d="M42 110 h124 v70 q0 30 -30 30 h-64 q-30 0 -30 -30 z" fill={SKIN} />
      <path d="M160 140 q30 -30 36 -54 q4 -14 -8 -16 q-10 -2 -16 12 l-18 34" fill={SKIN} />
      <ellipse cx="190" cy="80" rx="7" ry="9" fill={NAIL} stroke="none" transform="rotate(20 190 80)" />
    </g>
  );
}

function Thumb() {
  // A left hand on its side, thumb on top with its nail facing the camera.
  return (
    <g stroke={SKIN_EDGE} strokeWidth="2">
      <path d="M40 120 q0 -50 50 -50 h50 q20 0 20 20 v60 q0 30 -30 30 h-60 q-30 0 -30 -30 z" fill={SKIN} />
      <path d="M140 92 h40 q22 0 22 20 q0 20 -22 20 h-40 z" fill={SKIN} />
      <rect x="168" y="98" width="28" height="28" rx="12" fill={NAIL} stroke="none" />
    </g>
  );
}

function Card({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect width="90" height="57" rx="6" fill="#2f5aa8" />
      <rect x="10" y="20" width="16" height="12" rx="2" fill="#e2c35c" />
      <rect x="10" y="40" width="60" height="5" rx="2" fill="#cfd9f0" />
    </g>
  );
}
