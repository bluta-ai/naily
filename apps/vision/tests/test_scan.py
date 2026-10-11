"""End-to-end scan on a real photo. Skipped unless the models and a sample photo are available:

    NAILY_SAMPLE=/path/to/back-of-left-hand-with-card.jpg pytest
"""

import os
from pathlib import Path

import pytest

MODELS = Path(__file__).resolve().parent.parent / "models"
SAMPLE = os.environ.get("NAILY_SAMPLE")


@pytest.mark.skipif(not (MODELS / "nails_seg.onnx").exists() or not SAMPLE, reason="models or NAILY_SAMPLE missing")
def test_scan_sample_photo():
    from naily_vision.nails import Models
    from naily_vision.scan import scan

    step = os.environ.get("NAILY_SAMPLE_STEP", "left-hand")
    result = scan(Models(MODELS), Path(SAMPLE).read_bytes(), step)
    assert result["ok"], result.get("problem")
    assert len(result["nails"]) >= 3
    assert all(len(n["points"]) == 32 for n in result["nails"])


def test_rejects_garbage():
    if not (MODELS / "nails_seg.onnx").exists():
        pytest.skip("models missing")
    from naily_vision.nails import Models
    from naily_vision.scan import scan

    assert scan(Models(MODELS), b"not a photo", "left-hand") == {"ok": False, "problem": "unreadable"}
