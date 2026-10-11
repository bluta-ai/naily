import type { Design } from "./design.ts";

export interface Preset {
  id: string;
  name: { en: string; zh: string };
  design: Design;
}

/** Ready-made designs: one tap, no colour picking needed. */
export const PRESETS: Preset[] = [
  { id: "french", name: { en: "Classic French", zh: "经典法式" }, design: { main: { patternId: "french", params: { base: "#f8e1e4", tip: "#ffffff", depth: 0.25 } } } },
  { id: "rose", name: { en: "Rose red", zh: "玫瑰红" }, design: { main: { patternId: "solid", params: { base: "#c2185b" } } } },
  { id: "nude", name: { en: "Soft nude", zh: "裸色" }, design: { main: { patternId: "solid", params: { base: "#e3b5a4" } } } },
  { id: "wine", name: { en: "Wine", zh: "酒红" }, design: { main: { patternId: "solid", params: { base: "#6d1a36" } } } },
  { id: "peach", name: { en: "Peach ombré", zh: "蜜桃渐变" }, design: { main: { patternId: "ombre", params: { from: "#ff8a80", to: "#fff3e0" } } } },
  { id: "lilac", name: { en: "Lilac moon", zh: "丁香半月" }, design: { main: { patternId: "half-moon", params: { base: "#9575cd", moon: "#ede7f6" } } } },
  { id: "gold", name: { en: "Gold glitter", zh: "金色亮片" }, design: { main: { patternId: "glitter", params: { base: "#fce4ec", glitter: "#c9a227" } } } },
  { id: "marble", name: { en: "White marble", zh: "白色大理石" }, design: { main: { patternId: "marble", params: { base: "#fafafa", vein: "#9e9e9e" } } } },
  { id: "dots", name: { en: "Navy dots", zh: "藏青波点" }, design: { main: { patternId: "dots", params: { base: "#1a237e", dot: "#ffffff", spacing: 3 } } } },
  { id: "chevron", name: { en: "Black V tip", zh: "黑色V尖" }, design: { main: { patternId: "chevron", params: { base: "#fafafa", tip: "#000000" } } } },
  {
    id: "red-gold",
    name: { en: "Red with gold", zh: "红配金" },
    design: {
      main: { patternId: "solid", params: { base: "#b71c1c" } },
      accent: { fingers: ["L4", "R4"], patternId: "glitter", params: { base: "#b71c1c", glitter: "#e6c35c" } },
    },
  },
  { id: "sea", name: { en: "Sea stripes", zh: "海军条纹" }, design: { main: { patternId: "stripes", params: { base: "#0d47a1", stripe: "#ffffff", angle: 35, gap: 2.5 } } } },
];
