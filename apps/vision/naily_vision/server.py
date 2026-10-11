"""HTTP API for the scanner. Photos are processed in memory and never written to disk."""

from __future__ import annotations

import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query, Request

from .nails import Models
from .scan import STEPS, scan

MODEL_DIR = Path(os.environ.get("NAILY_MODELS", Path(__file__).resolve().parent.parent / "models"))
MAX_BYTES = 15 * 1024 * 1024

app = FastAPI(title="Naily vision")
_models: Models | None = None
# The ONNX sessions use every core already; one scan at a time keeps latency predictable.
_lock = threading.Lock()


def models() -> Models:
    global _models
    if _models is None:
        _models = Models(MODEL_DIR)
    return _models


@app.on_event("startup")
def _warm() -> None:
    models()


@app.get("/health")
def health() -> dict:
    return {"ok": True}


@app.post("/scan")
async def scan_photo(request: Request, step: str = Query(...)) -> dict:
    if step not in STEPS:
        raise HTTPException(400, f"step must be one of {', '.join(STEPS)}")
    data = await request.body()
    if not data:
        raise HTTPException(400, "Send the photo as the request body")
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Photo too large")
    with _lock:
        return scan(models(), data, step)  # type: ignore[arg-type]
