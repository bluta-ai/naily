import { describe, expect, it } from "vitest";
import {
  applyHomography,
  calibrateFromCard,
  centroid,
  completeHandSet,
  computeHomography,
  defaultOutline,
  defaultParams,
  FINGERS,
  invertMatrix3,
  measureNail,
  PATTERNS,
  pixelsToMm,
  priceOrder,
  REFERENCE_CARD,
  renderSheet,
  sizeForWidth,
  validateOrder,
  validatePatternParams,
  type Design,
  type FingerId,
  type NailOutline,
  type Point,
} from "../src/index.ts";

const W = REFERENCE_CARD.widthMm;
const H = REFERENCE_CARD.heightMm;
const cardMm: Point[] = [{ x: 0, y: 0 }, { x: W, y: 0 }, { x: W, y: H }, { x: 0, y: H }];

/** A phone held at an angle above the table: an arbitrary perspective camera. */
const camera = computeHomography(
  [{ x: -20, y: -60 }, { x: 120, y: -60 }, { x: 120, y: 80 }, { x: -20, y: 80 }],
  [{ x: 210, y: 140 }, { x: 1530, y: 190 }, { x: 1420, y: 1480 }, { x: 290, y: 1390 }],
);
const project = (pts: Point[]) => pts.map((p) => applyHomography(camera, p));

const rotate = (pts: Point[], deg: number, c: Point) => {
  const a = (deg * Math.PI) / 180;
  return pts.map((p) => ({
    x: c.x + (p.x - c.x) * Math.cos(a) - (p.y - c.y) * Math.sin(a),
    y: c.y + (p.x - c.x) * Math.sin(a) + (p.y - c.y) * Math.cos(a),
  }));
};

describe("homography", () => {
  it("maps the four correspondences exactly and inverts", () => {
    const img = project(cardMm);
    const h = computeHomography(cardMm, img);
    const inv = invertMatrix3(h);
    cardMm.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q.x).toBeCloseTo(img[i]!.x, 6);
      expect(q.y).toBeCloseTo(img[i]!.y, 6);
      const back = applyHomography(inv, q);
      expect(back.x).toBeCloseTo(p.x, 6);
    });
  });
});

describe("calibration + measurement", () => {
  const nailCentre = { x: 40, y: -30 };
  const nailMm = rotate(defaultOutline(nailCentre, 14, 16), 20, nailCentre);

  it.each([
    ["clockwise from top-left", [0, 1, 2, 3]],
    ["starting elsewhere", [2, 3, 0, 1]],
    ["counter-clockwise", [3, 2, 1, 0]],
    ["portrait-start", [1, 2, 3, 0]],
  ])("recovers true nail size through perspective (%s)", (_label, order) => {
    const cornersPx = order.map((i) => project(cardMm)[i]!);
    const cal = calibrateFromCard(cornersPx);
    const nail: NailOutline = { finger: "R2", points: pixelsToMm(cal, project(nailMm)) };
    const m = measureNail(nail);
    // Catmull-Rom through 8 ellipse points bulges very slightly; sub-0.3 mm is far below a nail wrap's tolerance.
    expect(m.widthMm).toBeGreaterThan(13.8);
    expect(m.widthMm).toBeLessThan(14.3);
    expect(m.lengthMm).toBeGreaterThan(15.8);
    expect(m.lengthMm).toBeLessThan(16.3);
    expect(cal.warnings).not.toContain("aspect-mismatch");
  });

  it("never mirrors the nail", () => {
    // An asymmetric nail: the right side bulges. It must still bulge right after measuring.
    const pts = defaultOutline({ x: 40, y: -30 }, 12, 14);
    pts[2] = { x: pts[2]!.x + 2, y: pts[2]!.y };
    for (const order of [[0, 1, 2, 3], [3, 2, 1, 0]]) {
      const cal = calibrateFromCard(order.map((i) => project(cardMm)[i]!));
      const m = measureNail({ finger: "L3", points: pixelsToMm(cal, project(pts)) });
      // The cuticle→tip axis is vertical in the nail frame; the bulge must stay on its right.
      const tip = m.outline.reduce((a, b) => (b.y < a.y ? b : a));
      expect(centroid(m.outline).x).toBeGreaterThan(tip.x + 0.3);
    }
  });

  it("flags a badly placed card", () => {
    const cal = calibrateFromCard([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]);
    expect(cal.warnings).toContain("aspect-mismatch");
  });
});

describe("shape classification", () => {
  const shape = (points: Point[]) => measureNail({ finger: "R3", points }).shape;

  it("detects square tips", () => {
    expect(shape([
      { x: 0, y: -8 }, { x: 6, y: -7.8 }, { x: 6.5, y: 0 }, { x: 6, y: 7 },
      { x: 0, y: 8 }, { x: -6, y: 7 }, { x: -6.5, y: 0 }, { x: -6, y: -7.8 },
    ])).toBe("square");
  });

  it("detects oval nails", () => {
    expect(shape(defaultOutline({ x: 0, y: 0 }, 12, 15))).toBe("oval");
  });

  it("detects pointed nails", () => {
    expect(["almond", "stiletto"]).toContain(shape([
      { x: 0, y: -12 }, { x: 2.5, y: -6 }, { x: 6, y: 1 }, { x: 5.5, y: 7 },
      { x: 0, y: 8 }, { x: -5.5, y: 7 }, { x: -6, y: 1 }, { x: -2.5, y: -6 },
    ]));
  });
});

describe("sizing", () => {
  it("picks the narrowest stock size that covers the nail", () => {
    expect(sizeForWidth(17.9)).toBe(0);
    expect(sizeForWidth(14)).toBe(4);
    expect(sizeForWidth(13.2)).toBe(5); // within 0.3 mm grace of size 5
    expect(sizeForWidth(13.4)).toBe(4);
    expect(sizeForWidth(6)).toBe(11);
    expect(sizeForWidth(25)).toBe(0);
  });
});

const fullHand = (): NailOutline[] =>
  FINGERS.map((finger, i) => ({
    finger,
    points: defaultOutline({ x: i * 20, y: 0 }, finger.endsWith("1") ? 15 : 11, 13),
  }));

describe("completeHandSet", () => {
  it("mirrors missing fingers from the other hand", () => {
    const left = fullHand().filter((n) => n.finger.startsWith("L"));
    const set = completeHandSet(left);
    expect(set.map((n) => n.finger)).toEqual(FINGERS);
    const r1 = set.find((n) => n.finger === "R1")!;
    expect(r1.estimated).toBe(true);
    expect(measureNail(r1).widthMm).toBeCloseTo(measureNail(left[0]!).widthMm, 6);
  });
});

describe("patterns and sheet", () => {
  it("every pattern renders with its defaults", () => {
    for (const p of PATTERNS) {
      expect(validatePatternParams(p.id, defaultParams(p))).toEqual([]);
      expect(p.render(defaultParams(p) as never, { width: 12, height: 14, uid: "t", seed: 3 })).toMatch(/^</);
    }
  });

  it("rejects markup injected through colours", () => {
    expect(validatePatternParams("solid", { base: '"/><script>' })).not.toEqual([]);
  });

  it("renders a physically sized sheet with cut lines", () => {
    const design: Design = {
      main: { patternId: "french", params: defaultParams(PATTERNS[1]!) },
      accent: { fingers: ["L4", "R4"], patternId: "glitter", params: defaultParams(PATTERNS.at(-1)!) },
    };
    const svg = renderSheet(fullHand().map(measureNail), design, { title: "Order <1>" });
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg.match(/stroke="#ff0000"/g)).toHaveLength(10);
    expect(svg).not.toContain("<1>");
  });
});

const validOrder = () => ({
  product: "press-on",
  sets: 1,
  nails: fullHand(),
  design: { main: { patternId: "solid", params: { base: "#aa0000" } } },
  shipping: {
    name: "Li Hua",
    phone: "+86 138 0000 0000",
    line1: "1 Example Road",
    city: "Shanghai",
    region: "Shanghai",
    postalCode: "200000",
    country: "CN",
  },
});

describe("orders", () => {
  it("accepts a complete order", () => {
    expect(validateOrder(validOrder())).toEqual([]);
  });

  it("rejects missing nails and implausible sizes", () => {
    const o = validOrder();
    o.nails = o.nails.slice(0, 9);
    expect(validateOrder(o)).toContain("All 10 nails are required");

    const huge = validOrder();
    huge.nails[0] = { finger: "L1" as FingerId, points: defaultOutline({ x: 0, y: 0 }, 60, 60) };
    expect(validateOrder(huge).join()).toMatch(/L1: width/);
  });

  it("prices with free shipping over the threshold", () => {
    expect(priceOrder("press-on", 1)).toEqual({ currency: "CNY", subtotalFen: 12900, shippingFen: 1200, totalFen: 14100 });
    expect(priceOrder("press-on", 2).shippingFen).toBe(0);
  });
});

describe("presets", () => {
  it("are all valid designs", async () => {
    const { PRESETS } = await import("../src/index.ts");
    for (const p of PRESETS) {
      expect(validatePatternParams(p.design.main.patternId, p.design.main.params)).toEqual([]);
      if (p.design.accent) expect(validatePatternParams(p.design.accent.patternId, p.design.accent.params)).toEqual([]);
    }
  });
});
