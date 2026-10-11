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
