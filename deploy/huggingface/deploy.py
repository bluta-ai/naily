"""Publishes Naily to a Hugging Face Space (free Docker hosting with an HTTPS link).

    pip install huggingface_hub
    python apps/vision/fetch_models.py            # once, ~100 MB
    HF_TOKEN=hf_xxx python deploy/huggingface/deploy.py <your-hf-username>/naily [--admin-token SECRET]

The Space builds the container itself (about 5–10 minutes the first time) and is then live at
https://<your-hf-username>-naily.hf.space
"""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from huggingface_hub import HfApi

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
MODELS = ROOT / "apps/vision/models"
NEEDED = ["hand_landmarker.task", "mobile_sam_image_encoder.onnx", "sam_mask_decoder_multi.onnx", "nails_seg.onnx"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("space", help="e.g. yourname/naily")
    ap.add_argument("--admin-token", help="password for the admin endpoints (order list, print files)")
    ap.add_argument("--private", action="store_true")
    args = ap.parse_args()

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise SystemExit("Set HF_TOKEN to a Hugging Face access token with write permission.")
    missing = [m for m in NEEDED if not (MODELS / m).exists()]
    if missing:
        raise SystemExit(f"Missing models {missing}: run python apps/vision/fetch_models.py first.")

    api = HfApi(token=token)
    api.create_repo(args.space, repo_type="space", space_sdk="docker", private=args.private, exist_ok=True)
    if args.admin_token:
        api.add_space_secret(args.space, "ADMIN_TOKEN", args.admin_token)

    with tempfile.TemporaryDirectory() as tmp:
        stage = Path(tmp)
        files = subprocess.check_output(["git", "ls-files"], cwd=ROOT, text=True).splitlines()
        for f in files:
            src = ROOT / f
            if src.is_file():
                (stage / f).parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, stage / f)
        (stage / "apps/vision/models").mkdir(parents=True, exist_ok=True)
        for m in NEEDED:
            shutil.copy2(MODELS / m, stage / "apps/vision/models" / m)
        # A Space is configured by the README front matter and builds the root Dockerfile.
        shutil.copy2(HERE / "README.md", stage / "README.md")
        shutil.copy2(HERE / "Dockerfile", stage / "Dockerfile")
        (stage / ".dockerignore").write_text("node_modules\n**/node_modules\n**/__pycache__\n**/dist\n")
        api.upload_folder(repo_id=args.space, repo_type="space", folder_path=stage, commit_message="Deploy Naily")

    user, name = args.space.split("/")
    print(f"Uploaded. Building now; then open https://{user.lower()}-{name.lower()}.hf.space")


if __name__ == "__main__":
    main()
