/// <reference lib="webworker" />
/**
 * Runs the SAM image encoder (the slowest model) off the main thread. The page starts a few of
 * these so several nails are encoded at the same time on multi-core phones.
 */
import * as ort from "onnxruntime-web/wasm";

let session: ort.InferenceSession | null = null;

type Msg =
  | { type: "init"; model: ArrayBuffer; wasmPaths: { mjs: string; wasm: string } }
  | { type: "run"; id: number; data: Float32Array; dims: number[] };

self.onmessage = async (e: MessageEvent<Msg>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = msg.wasmPaths;
      session = await ort.InferenceSession.create(new Uint8Array(msg.model), { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
      self.postMessage({ type: "ready" });
    } else {
      const out = await session!.run({ input_image: new ort.Tensor("float32", msg.data, msg.dims) });
      const t = out[session!.outputNames[0]!]!;
      const data = t.data as Float32Array;
      self.postMessage({ type: "result", id: msg.id, data, dims: t.dims }, [data.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: msg.type === "run" ? msg.id : -1, message: String(err) });
  }
};
