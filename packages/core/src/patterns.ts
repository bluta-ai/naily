/**
 * Pattern library. Each pattern draws into a nail-sized box (millimetres, tip at y=0) and is
 * clipped to the real nail outline by the caller, so the same artwork fits every finger.
 * The output is plain SVG markup so the browser preview and the factory print file are
 * produced by exactly the same code.
 */

export interface PatternParamSpec {
  key: string;
  label: { en: string; zh: string };
  type: "color" | "number";
  default: string | number;
  min?: number;
  max?: number;
  step?: number;
}

export type PatternParams = Record<string, string | number>;

export interface PatternContext {
  width: number;
  height: number;
  /** Unique id prefix for gradients and similar defs. */
  uid: string;
  /** Deterministic per-nail seed so random patterns differ per finger but are reproducible. */
  seed: number;
}

export interface Pattern {
  id: string;
  name: { en: string; zh: string };
  params: PatternParamSpec[];
  render(p: Required<PatternParams>, ctx: PatternContext): string;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

const color = (p: PatternParams, k: string): string => {
  const v = p[k];
  if (typeof v !== "string" || !HEX.test(v)) throw new Error(`Invalid colour for ${k}`);
  return v;
};
const num = (p: PatternParams, k: string): number => {
  const v = p[k];
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`Invalid number for ${k}`);
  return v;
};
const r2 = (v: number) => Math.round(v * 100) / 100;

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const rect = (w: number, h: number, fill: string) =>
  `<rect x="-1" y="-1" width="${r2(w + 2)}" height="${r2(h + 2)}" fill="${fill}"/>`;

const c = (key: string, en: string, zh: string, def: string): PatternParamSpec => ({
  key,
  label: { en, zh },
  type: "color",
  default: def,
});

export const PATTERNS: Pattern[] = [
  {
    id: "solid",
    name: { en: "Solid", zh: "纯色" },
    params: [c("base", "Colour", "颜色", "#c2185b")],
    render: (p, { width, height }) => rect(width, height, color(p, "base")),
  },
  {
    id: "french",
    name: { en: "French tip", zh: "法式" },
    params: [
      c("base", "Base", "底色", "#f8e1e4"),
      c("tip", "Tip", "甲尖", "#ffffff"),
      { key: "depth", label: { en: "Tip depth", zh: "甲尖深度" }, type: "number", default: 0.25, min: 0.1, max: 0.5, step: 0.05 },
    ],
    render: (p, { width, height }) => {
      const d = num(p, "depth") * height;
      return (
        rect(width, height, color(p, "base")) +
        `<path d="M-1 -1 H${r2(width + 1)} V${r2(d * 0.6)} Q${r2(width / 2)} ${r2(d * 1.6)} -1 ${r2(d * 0.6)} Z" fill="${color(p, "tip")}"/>`
      );
    },
  },
  {
    id: "ombre",
    name: { en: "Ombré", zh: "渐变" },
    params: [c("from", "Tip", "甲尖", "#ff8a80"), c("to", "Cuticle", "甲根", "#fff3e0")],
    render: (p, { width, height, uid }) =>
      `<defs><linearGradient id="${uid}-g" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${color(p, "from")}"/><stop offset="1" stop-color="${color(p, "to")}"/>` +
      `</linearGradient></defs>` +
      rect(width, height, `url(#${uid}-g)`),
  },
  {
    id: "dots",
    name: { en: "Polka dots", zh: "波点" },
    params: [
      c("base", "Base", "底色", "#212121"),
      c("dot", "Dots", "圆点", "#ffffff"),
      { key: "spacing", label: { en: "Spacing (mm)", zh: "间距 (毫米)" }, type: "number", default: 3, min: 1.5, max: 6, step: 0.5 },
    ],
    render: (p, { width, height }) => {
      const s = num(p, "spacing");
      const dot = color(p, "dot");
      let out = rect(width, height, color(p, "base"));
      for (let row = 0, y = s / 2; y < height + s; row++, y += s * 0.87) {
        for (let x = row % 2 ? 0 : s / 2; x < width + s; x += s) {
          out += `<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(s * 0.22)}" fill="${dot}"/>`;
        }
      }
      return out;
    },
  },
  {
    id: "stripes",
    name: { en: "Stripes", zh: "条纹" },
    params: [
      c("base", "Base", "底色", "#0d47a1"),
      c("stripe", "Stripe", "条纹", "#ffd54f"),
      { key: "angle", label: { en: "Angle", zh: "角度" }, type: "number", default: 35, min: -90, max: 90, step: 5 },
      { key: "gap", label: { en: "Spacing (mm)", zh: "间距 (毫米)" }, type: "number", default: 2.5, min: 1, max: 6, step: 0.5 },
    ],
    render: (p, { width, height }) => {
      const gap = num(p, "gap");
      const span = Math.hypot(width, height);
      let lines = "";
      for (let x = -span; x < span; x += gap) {
        lines += `<rect x="${r2(x)}" y="${r2(-span)}" width="${r2(gap * 0.4)}" height="${r2(span * 2)}"/>`;
      }
      return (
        rect(width, height, color(p, "base")) +
        `<g fill="${color(p, "stripe")}" transform="translate(${r2(width / 2)} ${r2(height / 2)}) rotate(${r2(num(p, "angle"))})">${lines}</g>`
      );
    },
  },
  {
    id: "half-moon",
    name: { en: "Half moon", zh: "半月" },
    params: [c("base", "Base", "底色", "#4a148c"), c("moon", "Moon", "月牙", "#e1bee7")],
    render: (p, { width, height }) =>
      rect(width, height, color(p, "base")) +
      `<ellipse cx="${r2(width / 2)}" cy="${r2(height)}" rx="${r2(width * 0.42)}" ry="${r2(height * 0.28)}" fill="${color(p, "moon")}"/>`,
  },
  {
    id: "chevron",
    name: { en: "Chevron tip", zh: "V形甲尖" },
    params: [c("base", "Base", "底色", "#fafafa"), c("tip", "Tip", "甲尖", "#000000")],
    render: (p, { width, height }) =>
      rect(width, height, color(p, "base")) +
      `<path d="M-1 -1 H${r2(width + 1)} V${r2(height * 0.12)} L${r2(width / 2)} ${r2(height * 0.4)} L-1 ${r2(height * 0.12)} Z" fill="${color(p, "tip")}"/>`,
  },
  {
    id: "marble",
    name: { en: "Marble", zh: "大理石" },
    params: [c("base", "Base", "底色", "#fafafa"), c("vein", "Veins", "纹理", "#9e9e9e")],
    render: (p, { width, height, seed }) => {
      const rand = rng(seed);
      const vein = color(p, "vein");
      let out = rect(width, height, color(p, "base"));
      for (let i = 0; i < 4; i++) {
        let x = rand() * width;
        let y = -1;
        let d = `M${r2(x)} ${r2(y)}`;
        while (y < height + 1) {
          const nx = x + (rand() - 0.5) * width * 0.6;
          const ny = y + height * (0.15 + rand() * 0.2);
          d += ` Q${r2((x + nx) / 2 + (rand() - 0.5) * 3)} ${r2((y + ny) / 2)} ${r2(nx)} ${r2(ny)}`;
          x = nx;
          y = ny;
        }
        out += `<path d="${d}" fill="none" stroke="${vein}" stroke-width="${r2(0.15 + rand() * 0.45)}" stroke-linecap="round" opacity="0.8"/>`;
      }
      return out;
    },
  },
  {
    id: "glitter",
    name: { en: "Glitter fade", zh: "亮片渐变" },
    params: [c("base", "Base", "底色", "#fce4ec"), c("glitter", "Glitter", "亮片", "#c9a227")],
    render: (p, { width, height, seed }) => {
      const rand = rng(seed);
      const g = color(p, "glitter");
      let out = rect(width, height, color(p, "base"));
      const count = Math.round(width * height * 0.9);
      for (let i = 0; i < count; i++) {
        // Denser at the tip, fading towards the cuticle.
        const y = Math.pow(rand(), 1.8) * height;
        out += `<circle cx="${r2(rand() * width)}" cy="${r2(y)}" r="${r2(0.1 + rand() * 0.25)}" fill="${g}"/>`;
      }
      return out;
    },
  },
];

export const getPattern = (id: string): Pattern | undefined => PATTERNS.find((p) => p.id === id);

export function defaultParams(pattern: Pattern): PatternParams {
  return Object.fromEntries(pattern.params.map((s) => [s.key, s.default]));
}

/** Returns a list of problems; empty when `params` is valid for the pattern. */
export function validatePatternParams(patternId: string, params: unknown): string[] {
  const pattern = getPattern(patternId);
  if (!pattern) return [`Unknown pattern "${patternId}"`];
  if (typeof params !== "object" || params === null) return ["Pattern params must be an object"];
  const errors: string[] = [];
  const obj = params as Record<string, unknown>;
  for (const spec of pattern.params) {
    const v = obj[spec.key];
    if (spec.type === "color") {
      if (typeof v !== "string" || !HEX.test(v)) errors.push(`${spec.key} must be a #rrggbb colour`);
    } else if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`${spec.key} must be a number`);
    } else if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) {
      errors.push(`${spec.key} must be between ${spec.min} and ${spec.max}`);
    }
  }
  for (const key of Object.keys(obj)) {
    if (!pattern.params.some((s) => s.key === key)) errors.push(`Unknown param "${key}"`);
  }
  return errors;
}
