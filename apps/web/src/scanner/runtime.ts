/**
 * Loads everything the in-browser scanner needs, once, with progress for the UI.
 * Used when the site runs without a server (e.g. hosted as a Claude Artifact):
 * OpenCV from the jsDelivr CDN, models and WebAssembly from files published next to the page.
 */
import * as ort from "onnxruntime-web/wasm";
import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

const OPENCV_URL = "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1/dist/opencv.js";

/** Lists the files of each model; large models are split to stay under per-file upload limits. */
const MANIFEST = "models/manifest.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CV = any;

export interface Runtime {
  cv: CV;
  hands: HandLandmarker;
  yolo: ort.InferenceSession;
  /** SAM image encoder, run in background workers: (HxWx3 float RGB) → embedding. */
  encode(data: Float32Array, dims: number[]): Promise<ort.Tensor>;
  decoder: ort.InferenceSession;
  ort: typeof ort;
}

/** A small pool of workers, each with its own copy of the SAM encoder. */
async function startEncoderPool(model: Uint8Array, wasmPaths: { mjs: string; wasm: string }) {
  const size = Math.max(1, Math.min(2, (navigator.hardwareConcurrency || 2) - 1));
  const workers = await Promise.all(
    Array.from({ length: size }, async () => {
      const w = new Worker(new URL("./encoder.worker.ts", import.meta.url), { type: "module" });
      await new Promise<void>((resolve, reject) => {
        w.onmessage = (e) => (e.data.type === "ready" ? resolve() : reject(new Error(e.data.message)));
        const copy = model.slice().buffer;
        w.postMessage({ type: "init", model: copy, wasmPaths }, [copy]);
      });
      return w;
    }),
  );
  const idle = [...workers];
  const waiting: ((w: Worker) => void)[] = [];
  let nextId = 0;
  const acquire = () => new Promise<Worker>((r) => (idle.length ? r(idle.pop()!) : waiting.push(r)));
  const release = (w: Worker) => (waiting.length ? waiting.shift()!(w) : idle.push(w));
  return async (data: Float32Array, dims: number[]): Promise<ort.Tensor> => {
    const w = await acquire();
    try {
      const id = nextId++;
      const result = await new Promise<{ data: Float32Array; dims: number[] }>((resolve, reject) => {
        w.onmessage = (e) => {
          if (e.data.id !== id) return;
          if (e.data.type === "result") resolve(e.data);
          else reject(new Error(e.data.message));
        };
        w.postMessage({ type: "run", id, data, dims }, [data.buffer]);
      });
      return new ort.Tensor("float32", result.data, result.dims);
    } finally {
      release(w);
    }
  };
}

let loading: Promise<Runtime> | null = null;
type Progress = (fraction: number) => void;

const url = (path: string) => new URL(path, document.baseURI).href;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Resolves to `{ cv }`, not `cv` itself: the OpenCV module has a `then` method, so returning it
 * from an async function would make the promise wait on it forever.
 */
async function loadOpenCv(): Promise<{ cv: CV }> {
  const w = window as unknown as { cv?: CV };
  if (!w.cv) await loadScript(OPENCV_URL);
  let cv = w.cv;
  if (cv instanceof Promise) cv = await cv;
  for (let i = 0; !w.cv?.Mat && !cv?.Mat && i < 600; i++) await new Promise((r) => setTimeout(r, 50));
  cv = cv?.Mat ? cv : w.cv;
  if (!cv?.Mat) throw new Error("OpenCV did not start");
  return { cv };
}

/** Downloads files, reporting combined progress; joins split files back together. */
async function fetchAll(groups: string[][], onBytes: (n: number) => void): Promise<Uint8Array[]> {
  return Promise.all(
    groups.map(async (parts) => {
      const chunks = await Promise.all(
        parts.map(async (p) => {
          const res = await fetch(url(p));
          if (!res.ok || !res.body) throw new Error(`Could not download ${p}`);
          const reader = res.body.getReader();
          const pieces: Uint8Array[] = [];
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            pieces.push(value);
            onBytes(value.length);
          }
          return concat(pieces);
        }),
      );
      return concat(chunks);
    }),
  );
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 1) return parts[0]!;
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Approximate total download, for the progress bar (models + WebAssembly + OpenCV). */
const EXPECTED_BYTES = 75e6;

export function loadRuntime(onProgress: Progress = () => {}): Promise<Runtime> {
  if (!loading) {
    loading = (async () => {
      let received = 0;
      const tick = (n: number) => {
        received += n;
        onProgress(Math.min(0.99, received / EXPECTED_BYTES));
      };
      ort.env.wasm.numThreads = 1; // threads need cross-origin isolation, which hosted pages lack
      const wasmPaths = { mjs: url("wasm/ort-wasm-simd-threaded.mjs"), wasm: url("wasm/ort-wasm-simd-threaded.wasm") };
      ort.env.wasm.wasmPaths = wasmPaths;

      const files = (await (await fetch(url(MANIFEST))).json()) as Record<string, string[]>;
      const [hand, yolo, encoder, decoder] = await fetchAll(
        ["hand_landmarker.task", "nails_seg.onnx", "mobile_sam_image_encoder.onnx", "sam_mask_decoder_multi.onnx"].map((m) => files[m]!),
        tick,
      );
      // ONNX Runtime must start before MediaPipe: MediaPipe's loader leaves globals that stall it.
      const opts: ort.InferenceSession.SessionOptions = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
      const y = await ort.InferenceSession.create(yolo!, opts);
      const encode = await startEncoderPool(encoder!, wasmPaths);
      const d = await ort.InferenceSession.create(decoder!, opts);
      const vision = await FilesetResolver.forVisionTasks(url("wasm/mediapipe"));
      const hands = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetBuffer: hand, delegate: "CPU" },
        runningMode: "IMAGE",
        numHands: 2,
        minHandDetectionConfidence: 0.3,
        minHandPresenceConfidence: 0.3,
      });
      // The three WebAssembly runtimes are started one after another; in parallel they stall.
      const { cv } = await loadOpenCv();
      tick(10e6);
      onProgress(1);
      return { cv, hands, yolo: y, encode, decoder: d, ort };
    })().catch((err) => {
      loading = null; // allow a retry
      throw err;
    });
  }
  return loading;
}
