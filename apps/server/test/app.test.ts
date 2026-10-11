import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { defaultOutline, FINGERS } from "@naily/core";
import { createApp } from "../src/app.ts";
import { OrderStore } from "../src/db.ts";

let server: Server;
let base: string;
const ADMIN = "test-admin-token";

beforeAll(async () => {
  const app = createApp({ store: new OrderStore(":memory:"), adminToken: ADMIN });
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

const order = () => ({
  product: "nail-wrap",
  sets: 1,
  nails: FINGERS.map((finger, i) => ({ finger, points: defaultOutline({ x: i * 20, y: 0 }, 12, 13) })),
  design: { main: { patternId: "dots", params: { base: "#000000", dot: "#ffffff", spacing: 3 } } },
  shipping: {
    name: "Wang Fang",
    phone: "13800000000",
    line1: "88 Example Street",
    city: "Hangzhou",
    region: "Zhejiang",
    postalCode: "310000",
    country: "CN",
  },
  price: { totalFen: 1 },
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: Response): Promise<any> => r.json();

const post = (body: unknown) =>
  fetch(`${base}/api/orders`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("orders API", () => {
  it("creates an order with a server-side price and hides personal data", async () => {
    const res = await post(order());
    expect(res.status).toBe(201);
    const created = await json(res);
    expect(created.id).toMatch(/^NL-[2-9A-Z]{8}$/);
    expect(created.price.totalFen).toBe(6900 + 1200);
    expect(JSON.stringify(created)).not.toContain("Wang Fang");

    const status = await json(await fetch(`${base}/api/orders/${created.id}`));
    expect(status.status).toBe("received");
  });

  it("rejects invalid orders", async () => {
    const res = await post({ ...order(), nails: [] });
    expect(res.status).toBe(400);
    expect((await json(res)).errors).toContain("All 10 nails are required");
  });

  it("protects admin endpoints and serves a 1:1 print sheet", async () => {
    expect((await fetch(`${base}/api/admin/orders`)).status).toBe(401);
    const { id } = await json(await post(order()));
    const auth = { authorization: `Bearer ${ADMIN}` };

    const list = await json(await fetch(`${base}/api/admin/orders`, { headers: auth }));
    expect(list.some((o: { id: string }) => o.id === id)).toBe(true);
    expect(list[0].price).not.toHaveProperty("totalFen", 1);

    const sheet = await fetch(`${base}/api/admin/orders/${id}/sheet.svg`, { headers: auth });
    expect(sheet.headers.get("content-type")).toContain("image/svg+xml");
    expect(await sheet.text()).toMatch(/^<svg[^>]+width="[\d.]+mm"/);

    const updated = await fetch(`${base}/api/admin/orders/${id}`, {
      method: "PATCH",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ status: "shipped", trackingNumber: "SF123" }),
    });
    expect((await json(updated)).trackingNumber).toBe("SF123");
  });
});

describe("scan API", () => {
  it("converts a scan to millimetres and reports problems in plain codes", async () => {
    const { createApp: create } = await import("../src/app.ts");
    const calls: string[] = [];
    const app = create({
      store: new OrderStore(":memory:"),
      scanPhoto: async (_photo, step) => {
        calls.push(step);
        if (step === "left-thumb") return { ok: false, problem: "no-card", width: 100, height: 100 };
        // Card 856 x 540 px → 10 px per mm; a 120 x 130 px oval nail → about 12 x 13 mm.
        const oval = Array.from({ length: 32 }, (_, i) => {
          const a = (i / 32) * Math.PI * 2;
          return [500 + Math.sin(a) * 60, 300 - Math.cos(a) * 65] as [number, number];
        });
        return {
          ok: true, width: 2000, height: 1500, focal35: 26,
          card: [[100, 800], [956, 800], [956, 1340], [100, 1340]],
          nails: [{ finger: "L2", points: oval, confidence: 0.9 }],
        };
      },
    });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/scan`;
    const send = (step: string) =>
      fetch(`${url}?step=${step}`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1, 2, 3]) });

    const ok = await json(await send("left-hand"));
    expect(ok.ok).toBe(true);
    expect(ok.nails[0].finger).toBe("L2");
    // Slightly under 12 mm: the nail sits above the card, closer to the camera.
    expect(ok.nails[0].widthMm).toBeGreaterThan(11);
    expect(ok.nails[0].widthMm).toBeLessThan(12);

    expect(await json(await send("left-thumb"))).toMatchObject({ ok: false, problem: "no-card" });
    expect((await send("both-feet")).status).toBe(400);
    expect(calls).toEqual(["left-hand", "left-thumb"]);
    srv.close();
  });

  it("says the scanner is unavailable instead of crashing", async () => {
    const { createApp: create } = await import("../src/app.ts");
    const app = create({ store: new OrderStore(":memory:"), visionUrl: "http://127.0.0.1:1" });
    const srv = app.listen(0);
    await new Promise((r) => srv.once("listening", r));
    const res = await fetch(`http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/scan?step=left-hand`, {
      method: "POST", headers: { "content-type": "image/jpeg" }, body: new Uint8Array([1]),
    });
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ problem: "service-unavailable" });
    srv.close();
  });
});
