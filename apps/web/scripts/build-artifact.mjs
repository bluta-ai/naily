// Builds the server-less version of the site for hosting as a Claude Artifact.
//   1. python apps/vision/export_browser_models.py   (models → public-artifact/models)
//   2. npm run build:artifact -w @naily/web           (this script)
// Output: dist-artifact/naily.html (the page) plus app.js, wasm/ and models/ next to it.
import { cpSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const web = path.resolve(import.meta.dirname, "..");
const root = path.resolve(web, "../..");
const pub = path.join(web, "public-artifact");

if (!existsSync(path.join(pub, "models", "manifest.json"))) {
  console.error("Models missing: run `python apps/vision/export_browser_models.py` first.");
  process.exit(1);
}
mkdirSync(path.join(pub, "wasm", "mediapipe"), { recursive: true });
for (const f of ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs"]) {
  cpSync(path.join(root, "node_modules/onnxruntime-web/dist", f), path.join(pub, "wasm", f));
}
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  cpSync(path.join(root, "node_modules/@mediapipe/tasks-vision/wasm", f), path.join(pub, "wasm/mediapipe", f));
}

execSync("npx tsc -p tsconfig.json && npx vite build --mode artifact", { cwd: web, stdio: "inherit" });

// Artifacts serve only web file types; the page just downloads the bytes, so model files are
// published with a .wasm extension (a served type) and the manifest points at the new names.
const models = path.join(web, "dist-artifact", "models");
const manifest = JSON.parse(readFileSync(path.join(models, "manifest.json"), "utf8"));
for (const f of readdirSync(models)) if (f !== "manifest.json") renameSync(path.join(models, f), path.join(models, f + ".wasm"));
for (const k of Object.keys(manifest)) manifest[k] = manifest[k].map((p) => p + ".wasm");
writeFileSync(path.join(models, "manifest.json"), JSON.stringify(manifest, null, 1));

// An Artifact page is a body fragment: the platform adds <!doctype>, <head> and <body> itself.
const dist = path.join(web, "dist-artifact");
const html = readFileSync(path.join(dist, "index.html"), "utf8");
const title = html.match(/<title>.*?<\/title>/s)?.[0] ?? "<title>Naily</title>";
const cssFiles = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
const css = cssFiles.map((f) => readFileSync(path.join(dist, f), "utf8")).join("\n");
writeFileSync(
  path.join(dist, "naily.html"),
  `${title}\n<style>\n${css}\n</style>\n<div id="root"></div>\n<script type="module" src="./app.js"></script>\n`,
);
console.log("Artifact page written to", path.join(dist, "naily.html"));
