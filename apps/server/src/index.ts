import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.ts";
import { OrderStore } from "./db.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.NAILY_DB ?? path.resolve(here, "../data/naily.sqlite");
if (dbPath !== ":memory:") mkdirSync(path.dirname(dbPath), { recursive: true });

const app = createApp({
  store: new OrderStore(dbPath),
  adminToken: process.env.ADMIN_TOKEN || undefined,
  staticDir: path.resolve(here, "../../web/dist"),
});

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Naily server on http://localhost:${port}`);
  if (!process.env.ADMIN_TOKEN) console.log("ADMIN_TOKEN not set: admin endpoints are disabled");
});
