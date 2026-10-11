import express, { type NextFunction, type Request, type Response } from "express";
import { timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  measureNail,
  measureScan,
  priceOrder,
  renderSheet,
  SCAN_STEPS,
  validateOrder,
  type OrderRequest,
  type ScanResult,
  type ScanStep,
} from "@naily/core";
import { ORDER_STATUSES, type OrderStatus, type OrderStore, type StoredOrder } from "./db.ts";

export interface AppOptions {
  store: OrderStore;
  /** Token for the workshop/admin endpoints. Admin routes are disabled when unset. */
  adminToken?: string;
  /** Built web app to serve (apps/web/dist). */
  staticDir?: string;
  /** Sends a photo to the vision service. Defaults to POSTing to `visionUrl`. */
  scanPhoto?: (photo: Buffer, step: ScanStep) => Promise<ScanResult>;
  visionUrl?: string;
}

export function visionClient(visionUrl: string) {
  return async (photo: Buffer, step: ScanStep): Promise<ScanResult> => {
    const res = await fetch(`${visionUrl}/scan?step=${step}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body: new Uint8Array(photo),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Vision service answered ${res.status}`);
    return (await res.json()) as ScanResult;
  };
}

/** What a customer may see about their order: no address or phone. */
const publicView = (o: StoredOrder) => ({
  id: o.id,
  createdAt: o.createdAt,
  status: o.status,
  trackingNumber: o.trackingNumber,
  product: o.request.product,
  sets: o.request.sets,
  price: o.price,
});

export function createApp({ store, adminToken, staticDir, scanPhoto, visionUrl = "http://127.0.0.1:8790" }: AppOptions) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  const scanner = scanPhoto ?? visionClient(visionUrl);

  /**
   * One photo in, nails in millimetres out. The photo is passed straight through to the vision
   * service and is never stored.
   */
  app.post(
    "/api/scan",
    express.raw({ type: ["image/*", "application/octet-stream"], limit: "15mb" }),
    async (req, res) => {
      const step = String(req.query.step) as ScanStep;
      if (!SCAN_STEPS.includes(step)) {
        res.status(400).json({ error: `step must be one of ${SCAN_STEPS.join(", ")}` });
        return;
      }
      if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
        res.status(400).json({ error: "Send the photo as the request body" });
        return;
      }
      let scan: ScanResult;
      try {
        scan = await scanner(req.body, step);
      } catch (err) {
        console.error("scan failed", err);
        res.status(503).json({ ok: false, problem: "service-unavailable" });
        return;
      }
      const preview = { width: scan.width, height: scan.height, card: scan.card ?? null, nails: scan.nails ?? [] };
      if (!scan.ok) {
        res.json({ ok: false, problem: scan.problem ?? "unreadable", preview });
        return;
      }
      try {
        const m = measureScan(scan);
        const describe = (n: (typeof m.nails)[number]) => {
          const size = measureNail(n);
          return { ...n, widthMm: size.widthMm, lengthMm: size.lengthMm, shape: size.shape };
        };
        res.json({
          ok: true,
          nails: m.nails.map(describe),
          sideThumb: m.sideThumb ? describe(m.sideThumb) : null,
          missing: scan.missing ?? [],
          warnings: m.warnings,
          preview,
        });
      } catch (err) {
        console.error("scan could not be measured", err);
        res.json({ ok: false, problem: "few-nails", preview });
      }
    },
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/orders", (req, res) => {
    const errors = validateOrder(req.body);
    if (errors.length) {
      res.status(400).json({ errors });
      return;
    }
    const body = req.body as OrderRequest;
    // Re-build the request from validated fields only, dropping anything unexpected.
    const request: OrderRequest = {
      product: body.product,
      sets: body.sets,
      nails: body.nails.map((n) => ({
        finger: n.finger,
        points: n.points.map((p) => ({ x: p.x, y: p.y })),
        ...(n.estimated ? { estimated: true } : {}),
      })),
      design: {
        main: { patternId: body.design.main.patternId, params: body.design.main.params },
        ...(body.design.accent
          ? {
              accent: {
                fingers: body.design.accent.fingers,
                patternId: body.design.accent.patternId,
                params: body.design.accent.params,
              },
            }
          : {}),
      },
      shipping: body.shipping,
      ...(body.email ? { email: body.email } : {}),
      ...(body.note ? { note: body.note } : {}),
    };
    // Prices are always computed here, never trusted from the client.
    const order = store.create(request, priceOrder(request.product, request.sets));
    res.status(201).json(publicView(order));
  });

  app.get("/api/orders/:id", (req, res) => {
    const order = store.get(req.params.id);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(publicView(order));
  });

  const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
    const given = req.get("authorization")?.replace(/^Bearer /, "") ?? String(req.query.token ?? "");
    const ok =
      adminToken !== undefined &&
      given.length === adminToken.length &&
      timingSafeEqual(Buffer.from(given), Buffer.from(adminToken));
    if (!ok) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };

  app.get("/api/admin/orders", requireAdmin, (_req, res) => {
    res.json(store.list());
  });

  /** Factory print file at 1:1 scale: open in Illustrator/Inkscape or send straight to the UV printer. */
  app.get("/api/admin/orders/:id/sheet.svg", requireAdmin, (req, res) => {
    const order = store.get(String(req.params.id));
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    const nails = order.request.nails.map(measureNail);
    const insetMm = order.request.product === "nail-wrap" ? 0.5 : 0;
    res
      .type("image/svg+xml")
      .send(renderSheet(nails, order.request.design, { insetMm, title: `${order.id} · ${order.request.product} × ${order.request.sets}` }));
  });

  app.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
    const { status, trackingNumber } = req.body ?? {};
    if (!ORDER_STATUSES.includes(status)) {
      res.status(400).json({ error: `status must be one of ${ORDER_STATUSES.join(", ")}` });
      return;
    }
    if (trackingNumber !== undefined && trackingNumber !== null && (typeof trackingNumber !== "string" || trackingNumber.length > 64)) {
      res.status(400).json({ error: "Invalid tracking number" });
      return;
    }
    const order = store.update(String(req.params.id), status as OrderStatus, trackingNumber ?? null);
    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }
    res.json(order);
  });

  if (staticDir && existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, "index.html")));
  }

  return app;
}
