import type { Point } from "./geometry.ts";
import {
  isFingerId,
  isValidOutlineLength,
  MAX_OUTLINE_POINTS,
  measureNail,
  MIN_OUTLINE_POINTS,
  type NailMeasurement,
  type NailOutline,
} from "./nail.ts";
import { validatePatternParams } from "./patterns.ts";
import type { Design } from "./design.ts";

export type Product = "press-on" | "nail-wrap";

export const PRODUCTS: Record<Product, { name: { en: string; zh: string }; priceFen: number }> = {
  "press-on": { name: { en: "Press-on nails (10 pcs)", zh: "穿戴甲（10片）" }, priceFen: 12900 },
  "nail-wrap": { name: { en: "Nail wraps (10 pcs)", zh: "美甲贴（10片）" }, priceFen: 6900 },
};

export const SHIPPING_FEN = 1200;
export const FREE_SHIPPING_FROM_FEN = 19900;
export const MAX_SETS = 10;

export interface ShippingAddress {
  name: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export interface OrderRequest {
  product: Product;
  sets: number;
  nails: NailOutline[];
  design: Design;
  shipping: ShippingAddress;
  email?: string;
  note?: string;
}

export interface Price {
  currency: "CNY";
  subtotalFen: number;
  shippingFen: number;
  totalFen: number;
}

export function priceOrder(product: Product, sets: number): Price {
  const subtotalFen = PRODUCTS[product].priceFen * sets;
  const shippingFen = subtotalFen >= FREE_SHIPPING_FROM_FEN ? 0 : SHIPPING_FEN;
  return { currency: "CNY", subtotalFen, shippingFen, totalFen: subtotalFen + shippingFen };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isPoint = (v: unknown): v is Point =>
  isObj(v) && Number.isFinite(v.x) && Number.isFinite(v.y) && Math.abs(v.x as number) < 1e4 && Math.abs(v.y as number) < 1e4;

const str = (v: unknown, max: number, required = true): v is string =>
  typeof v === "string" ? v.trim().length > 0 && v.length <= max : !required && v === undefined;

/** Plausible human nail dimensions; anything outside means the scan went wrong. */
export const NAIL_LIMITS = { minWidthMm: 4, maxWidthMm: 25, minLengthMm: 4, maxLengthMm: 40 };

export function checkNailPlausible(m: NailMeasurement): string | null {
  if (m.widthMm < NAIL_LIMITS.minWidthMm || m.widthMm > NAIL_LIMITS.maxWidthMm) {
    return `${m.finger}: width ${m.widthMm.toFixed(1)} mm looks wrong`;
  }
  if (m.lengthMm < NAIL_LIMITS.minLengthMm || m.lengthMm > NAIL_LIMITS.maxLengthMm) {
    return `${m.finger}: length ${m.lengthMm.toFixed(1)} mm looks wrong`;
  }
  return null;
}

/**
 * Validates an order coming from an untrusted client. Returns error messages (empty when valid).
 * Used by both the browser (for instant feedback) and the server (as the real gate).
 */
export function validateOrder(input: unknown): string[] {
  if (!isObj(input)) return ["Order must be an object"];
  const errors: string[] = [];

  if (input.product !== "press-on" && input.product !== "nail-wrap") errors.push("Unknown product");
  if (!Number.isInteger(input.sets) || (input.sets as number) < 1 || (input.sets as number) > MAX_SETS) {
    errors.push(`sets must be 1–${MAX_SETS}`);
  }

  if (!Array.isArray(input.nails) || input.nails.length !== 10) {
    errors.push("All 10 nails are required");
  } else {
    const seen = new Set<string>();
    for (const n of input.nails) {
      if (!isObj(n) || !isFingerId(n.finger)) {
        errors.push("Invalid nail entry");
        continue;
      }
      if (seen.has(n.finger)) errors.push(`Duplicate finger ${n.finger}`);
      seen.add(n.finger);
      if (!Array.isArray(n.points) || !isValidOutlineLength(n.points.length) || !n.points.every(isPoint)) {
        errors.push(`${n.finger}: outline needs ${MIN_OUTLINE_POINTS}–${MAX_OUTLINE_POINTS} points`);
        continue;
      }
      try {
        const problem = checkNailPlausible(measureNail(n as unknown as NailOutline));
        if (problem) errors.push(problem);
      } catch {
        errors.push(`${n.finger}: outline is degenerate`);
      }
    }
  }

  if (!isObj(input.design) || !isObj(input.design.main)) {
    errors.push("Design is required");
  } else {
    const { main, accent } = input.design;
    errors.push(...validatePatternParams(String((main as Record<string, unknown>).patternId), (main as Record<string, unknown>).params));
    if (accent !== undefined) {
      if (!isObj(accent) || !Array.isArray(accent.fingers) || !accent.fingers.every(isFingerId)) {
        errors.push("Invalid accent");
      } else {
        errors.push(...validatePatternParams(String(accent.patternId), accent.params).map((e) => `accent: ${e}`));
      }
    }
  }

  const s = input.shipping;
  if (!isObj(s)) {
    errors.push("Shipping address is required");
  } else {
    if (!str(s.name, 80)) errors.push("Name is required");
    if (typeof s.phone !== "string" || !/^\+?[0-9 ()-]{6,20}$/.test(s.phone)) errors.push("Valid phone is required");
    if (!str(s.line1, 200)) errors.push("Address is required");
    if (!str(s.line2, 200, false) && s.line2 !== "") errors.push("Address line 2 is too long");
    if (!str(s.city, 80)) errors.push("City is required");
    if (!str(s.region, 80)) errors.push("Province/region is required");
    if (!str(s.postalCode, 20)) errors.push("Postal code is required");
    if (!str(s.country, 56)) errors.push("Country is required");
  }
  if (input.email !== undefined && input.email !== "" && (typeof input.email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) {
    errors.push("Email is invalid");
  }
  if (input.note !== undefined && (typeof input.note !== "string" || input.note.length > 500)) errors.push("Note is too long");

  return errors;
}
