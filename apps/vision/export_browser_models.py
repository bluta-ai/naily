"""Prepares the models for the in-browser scanner (Claude Artifact build).

    python apps/vision/export_browser_models.py

The YOLO nail detector and the SAM decoder are quantized to 8 bits (about 4x smaller); the SAM
encoder stays at full precision because quantizing it changes nail widths by ~5%. Files are split
into parts under 14 MB, the per-file limit for Artifact uploads.
"""

from pathlib import Path
import json
import shutil

from onnxruntime.quantization import QuantType, quantize_dynamic

SRC = Path(__file__).resolve().parent / "models"
OUT = Path(__file__).resolve().parents[1] / "web" / "public-artifact" / "models"
PART = 14_000_000


def split(path: Path) -> None:
    data = path.read_bytes()
    if len(data) <= PART:
        return
    for i in range(0, len(data), PART):
        (path.parent / f"{path.name}.part{i // PART}").write_bytes(data[i : i + PART])
    path.unlink()


def main() -> None:
    import sys

    full = "--full" in sys.argv  # no quantization: bigger download, identical to the server
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir(parents=True, exist_ok=True)
    for name in ("nails_seg.onnx", "sam_mask_decoder_multi.onnx"):
        if full:
            shutil.copy2(SRC / name, OUT / name)
        else:
            quantize_dynamic(SRC / name, OUT / name, weight_type=QuantType.QUInt8)
    shutil.copy2(SRC / "mobile_sam_image_encoder.onnx", OUT / "mobile_sam_image_encoder.onnx")
    shutil.copy2(SRC / "hand_landmarker.task", OUT / "hand_landmarker.task")
    for f in list(OUT.iterdir()):
        if f.name != "manifest.json":
            split(f)
    # Which files make up each model, in order (the page joins split files back together).
    manifest = {}
    for name in ("hand_landmarker.task", "nails_seg.onnx", "mobile_sam_image_encoder.onnx", "sam_mask_decoder_multi.onnx"):
        parts = sorted(OUT.glob(f"{name}.part*"), key=lambda p: int(p.name.rsplit("part", 1)[1]))
        manifest[name] = [f"models/{p.name}" for p in parts] or [f"models/{name}"]
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
    for f in sorted(OUT.iterdir()):
        print(f"{f.name:45s} {f.stat().st_size / 1e6:5.1f} MB")


if __name__ == "__main__":
    main()
