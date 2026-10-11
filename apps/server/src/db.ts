import { DatabaseSync } from "node:sqlite";
import { randomBytes } from "node:crypto";
import type { OrderRequest, Price } from "@naily/core";

export const ORDER_STATUSES = ["received", "in-production", "shipped", "delivered", "cancelled"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface StoredOrder {
  id: string;
  createdAt: string;
  status: OrderStatus;
  trackingNumber: string | null;
  request: OrderRequest;
  price: Price;
}

interface Row {
  id: string;
  created_at: string;
  status: OrderStatus;
  tracking_number: string | null;
  request_json: string;
  price_json: string;
}

const fromRow = (r: Row): StoredOrder => ({
  id: r.id,
  createdAt: r.created_at,
  status: r.status,
  trackingNumber: r.tracking_number,
  request: JSON.parse(r.request_json),
  price: JSON.parse(r.price_json),
});

/** Short, unambiguous order code customers can read out, e.g. NL-7K3M9QX2. */
function newOrderId(): string {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  const bytes = randomBytes(8);
  return "NL-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export class OrderStore {
  private db: DatabaseSync;

  constructor(path = ":memory:") {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        tracking_number TEXT,
        request_json TEXT NOT NULL,
        price_json TEXT NOT NULL
      )`);
  }

  create(request: OrderRequest, price: Price): StoredOrder {
    const order: StoredOrder = {
      id: newOrderId(),
      createdAt: new Date().toISOString(),
      status: "received",
      trackingNumber: null,
      request,
      price,
    };
    this.db
      .prepare("INSERT INTO orders (id, created_at, status, tracking_number, request_json, price_json) VALUES (?, ?, ?, ?, ?, ?)")
      .run(order.id, order.createdAt, order.status, null, JSON.stringify(request), JSON.stringify(price));
    return order;
  }

  get(id: string): StoredOrder | undefined {
    const row = this.db.prepare("SELECT * FROM orders WHERE id = ?").get(id) as Row | undefined;
    return row ? fromRow(row) : undefined;
  }

  list(limit = 100): StoredOrder[] {
    const rows = this.db.prepare("SELECT * FROM orders ORDER BY created_at DESC LIMIT ?").all(limit) as unknown as Row[];
    return rows.map(fromRow);
  }

  update(id: string, status: OrderStatus, trackingNumber: string | null): StoredOrder | undefined {
    this.db.prepare("UPDATE orders SET status = ?, tracking_number = ? WHERE id = ?").run(status, trackingNumber, id);
    return this.get(id);
  }
}
