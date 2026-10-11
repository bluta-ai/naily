"""Downloads the three models the scanner needs into ./models (about 100 MB).

    python fetch_models.py

The nail detector is published as a PyTorch file; it is exported to ONNX once with the
`ultralytics` package (only needed for this step, not at runtime). Ultralytics is AGPL-3.0:
for commercial use, get an Ultralytics licence or retrain an Apache-licensed detector.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

MODELS = Path(__file__).resolve().parent / "models"
FILES = {
    # Google MediaPipe hand landmarks (Apache-2.0)
    "hand_landmarker.task": "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    # MobileSAM ONNX export (Apache-2.0 weights)
    "mobile_sam_image_encoder.onnx": "https://huggingface.co/Acly/MobileSAM/resolve/main/mobile_sam_image_encoder.onnx",
    "sam_mask_decoder_multi.onnx": "https://huggingface.co/Acly/MobileSAM/resolve/main/sam_mask_decoder_multi.onnx",
    # YOLOv8 nail segmenter by mnemic (CC-BY-4.0), exported below
    "nails_seg.pt": "https://huggingface.co/mnemic/nails_seg_yolov8/resolve/main/nails_seg_s_yolov8_v1.pt",
}


def main() -> None:
    MODELS.mkdir(exist_ok=True)
    for name, url in FILES.items():
        target = MODELS / name
        if target.exists() or (name == "nails_seg.pt" and (MODELS / "nails_seg.onnx").exists()):
            print(f"✓ {name}")
            continue
        print(f"↓ {name}")
        with urllib.request.urlopen(url) as r, open(target, "wb") as f:
            shutil.copyfileobj(r, f)
    if not (MODELS / "nails_seg.onnx").exists():
        print("→ exporting nails_seg.onnx (installs ultralytics temporarily)")
        subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", "ultralytics", "onnx", "onnxslim"])
        subprocess.check_call(
            [sys.executable, "-c", "from ultralytics import YOLO; YOLO('nails_seg.pt').export(format='onnx', imgsz=640, simplify=True)"],
            cwd=MODELS,
        )
        (MODELS / "nails_seg.pt").unlink()
    print("models ready in", MODELS)


if __name__ == "__main__":
    main()
