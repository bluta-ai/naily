"""One photo in, card corners and nail outlines out (pixels). Millimetres are computed by @naily/core."""

from __future__ import annotations

import io
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np
from PIL import Image, ImageOps

from .card import detect_card
from .nails import Models, detect_hands, find_nails, is_back_of_hand, resample_outline, sam_decode, sam_embed

Step = Literal["left-hand", "left-thumb", "right-hand", "right-thumb"]
STEPS: tuple[Step, ...] = ("left-hand", "left-thumb", "right-hand", "right-thumb")
MAX_SIDE = 2400
MIN_CONFIDENCE = 0.6
OUTLINE_POINTS = 32

# Problems the app turns into one friendly sentence and a "try again" button.
Problem = Literal["unreadable", "no-card", "card-too-small", "no-hand", "palm", "wrong-hand", "few-nails", "blurry"]


@dataclass
class Photo:
    rgb: np.ndarray
    focal35: float | None  # 35 mm-equivalent focal length from EXIF, if the phone kept it


def load_photo(data: bytes) -> Photo:
    img = Image.open(io.BytesIO(data))
    focal = None
    try:
        exif = img.getexif().get_ifd(0x8769)  # Exif sub-IFD
        f = exif.get(0xA405)  # FocalLengthIn35mmFilm
        focal = float(f) if f else None
    except Exception:
        pass
    img = ImageOps.exif_transpose(img).convert("RGB")
    if max(img.size) > MAX_SIDE:
        img.thumbnail((MAX_SIDE, MAX_SIDE), Image.Resampling.LANCZOS)
    return Photo(np.asarray(img), focal)


def scan(models: Models, data: bytes, step: Step) -> dict:
    try:
        photo = load_photo(data)
    except Exception:
        return {"ok": False, "problem": "unreadable"}
    rgb = photo.rgb
    h, w = rgb.shape[:2]
    side = "L" if step.startswith("left") else "R"
    thumb_step = step.endswith("thumb")
    base = {"width": w, "height": h, "focal35": photo.focal35}

    hands = detect_hands(models, rgb)

    sam_cache: list = []

    def segment(points, labels):
        if not sam_cache:
            sam_cache.append(sam_embed(models, rgb))
        emb, s = sam_cache[0]
        return sam_decode(models, emb, s, (h, w), points, labels)

    card = detect_card(rgb, [hd.landmarks for hd in hands], segment)
    if card is None:
        return {**base, "ok": False, "problem": "no-card"}
    card_px = card.corners.tolist()
    card_width_px = max(np.hypot(*(card.corners[i] - card.corners[(i + 1) % 4])) for i in range(4))
    if card_width_px < 0.12 * max(w, h):
        return {**base, "ok": False, "problem": "card-too-small", "card": card_px}

    if not hands:
        return {**base, "ok": False, "problem": "no-hand", "card": card_px}
    # The hand closest to the card is the customer's (a helper's fingers may also be in frame).
    centre = card.corners.mean(0)
    hand = min(hands, key=lambda hd: float(np.hypot(*(hd.landmarks.mean(0) - centre))))

    nails = find_nails(models, rgb, hand)
    wanted = [1] if thumb_step else [2, 3, 4, 5]
    good = {f: n for f, n in nails.items() if f in wanted and n.confidence >= MIN_CONFIDENCE}

    if not thumb_step and not is_back_of_hand(hand, side):
        # The landmark layout is mirrored: either the palm, or the other hand's back.
        problem = "wrong-hand" if len(good) >= 3 else "palm"
        return {**base, "ok": False, "problem": problem, "card": card_px}

    if not good or (not thumb_step and len(good) < 3):
        if _is_blurry(rgb, hand):
            problem = "blurry"
        elif not thumb_step and not any(f in nails for f in wanted):
            problem = "palm"  # a palm has no nails to find
        else:
            problem = "few-nails"
        return {**base, "ok": False, "problem": problem, "card": card_px}

    out = []
    for f, n in sorted(good.items()):
        pts = resample_outline(n.contour, n.tip, OUTLINE_POINTS)
        out.append({"finger": f"{side}{f}", "points": np.round(pts, 2).tolist(), "confidence": round(n.confidence, 3)})
    # A thumb seen on a flat hand is viewed side-on; keep it only as a fallback.
    side_thumb = None
    if not thumb_step and 1 in nails and nails[1].confidence >= MIN_CONFIDENCE:
        n = nails[1]
        side_thumb = {
            "finger": f"{side}1",
            "points": np.round(resample_outline(n.contour, n.tip, OUTLINE_POINTS), 2).tolist(),
            "confidence": round(n.confidence, 3),
        }
    missing = [f"{side}{f}" for f in wanted if f not in good]
    return {**base, "ok": True, "card": card_px, "nails": out, "sideThumb": side_thumb, "missing": missing}


def _is_blurry(rgb: np.ndarray, hand) -> bool:
    x0, y0 = hand.landmarks.min(0).astype(int).clip(0)
    x1, y1 = hand.landmarks.max(0).astype(int)
    roi = cv2.cvtColor(rgb[y0:y1, x0:x1], cv2.COLOR_RGB2GRAY)
    if roi.size == 0:
        return False
    roi = cv2.resize(roi, (400, int(400 * roi.shape[0] / max(1, roi.shape[1]))))
    return float(cv2.Laplacian(roi, cv2.CV_64F).var()) < 25
