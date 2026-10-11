"""Finds every fingernail in a photo.

1. MediaPipe Hand Landmarker locates each finger, so we know which nail belongs to which finger.
2. A YOLOv8 nail segmenter finds the nails (coarse masks) inside the hand region.
3. MobileSAM re-traces each nail on an upright, zoomed-in crop for sharp, accurate edges.

All coordinates are pixels (x right, y down) of the image passed in.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import mediapipe as mp
import numpy as np
import onnxruntime as ort

# MediaPipe hand landmark indices: (DIP joint, fingertip) for thumb..pinky.
# For the thumb the "DIP" is its IP joint.
FINGER_JOINTS = {1: (3, 4), 2: (7, 8), 3: (11, 12), 4: (15, 16), 5: (19, 20)}
SAM_SIZE = 1024
YOLO_SIZE = 640


@dataclass
class HandDetection:
    landmarks: np.ndarray  # (21, 2) pixels
    score: float
    #: Sign of (wrist→middle knuckle) × (index knuckle→pinky knuckle). For a known hand it tells
    #: whether we are looking at the back of the hand (nails visible) or the palm.
    chirality: int


@dataclass
class NailDetection:
    finger: int  # 1 = thumb … 5 = pinky
    contour: np.ndarray  # (N, 2) pixels, closed polygon
    tip: np.ndarray  # unit vector pointing from cuticle to free edge
    confidence: float
    reasons: list[str] = field(default_factory=list)


class Models:
    """Loads the models once; they are reused across requests."""

    def __init__(self, model_dir: Path, threads: int | None = None):
        base = mp.tasks.BaseOptions(model_asset_path=str(model_dir / "hand_landmarker.task"))
        self.hands = mp.tasks.vision.HandLandmarker.create_from_options(
            mp.tasks.vision.HandLandmarkerOptions(
                base_options=base,
                running_mode=mp.tasks.vision.RunningMode.IMAGE,
                num_hands=2,
                min_hand_detection_confidence=0.3,
                min_hand_presence_confidence=0.3,
            )
        )
        opts = ort.SessionOptions()
        opts.log_severity_level = 3
        if threads:
            opts.intra_op_num_threads = threads
        self.yolo = ort.InferenceSession(str(model_dir / "nails_seg.onnx"), opts)
        self.encoder = ort.InferenceSession(str(model_dir / "mobile_sam_image_encoder.onnx"), opts)
        self.decoder = ort.InferenceSession(str(model_dir / "sam_mask_decoder_multi.onnx"), opts)


# --------------------------------------------------------------------------- hands


def detect_hands(models: Models, rgb: np.ndarray) -> list[HandDetection]:
    h, w = rgb.shape[:2]
    result = models.hands.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)))
    hands = []
    for lms, handed in zip(result.hand_landmarks, result.handedness):
        pts = np.array([[lm.x * w, lm.y * h] for lm in lms], dtype=np.float64)
        axis = pts[9] - pts[0]
        across = pts[17] - pts[5]
        chirality = 1 if axis[0] * across[1] - axis[1] * across[0] > 0 else -1
        hands.append(HandDetection(pts, float(handed[0].score), chirality))
    return hands


def is_back_of_hand(hand: HandDetection, side: str) -> bool:
    """True when the photo shows the back of `side` ("L"/"R") hand, i.e. the nails face the camera.

    Looking down at the back of a left hand (fingers up) the thumb is on the right; the palm
    side is the mirror image. In y-down image coordinates the back of a left hand has
    chirality -1 and the back of a right hand +1; rotating the photo does not change the sign.
    """
    return hand.chirality == (-1 if side == "L" else 1)


# --------------------------------------------------------------------------- YOLO nail detector


@dataclass
class NailCandidate:
    box: np.ndarray  # x0, y0, x1, y1 in image pixels
    mask: np.ndarray  # bool, full image size
    score: float


def detect_nail_candidates(models: Models, rgb: np.ndarray, region: tuple[int, int, int, int]) -> list[NailCandidate]:
    """Runs the YOLO nail segmenter on `region` (x0, y0, x1, y1) of the image."""
    x0, y0, x1, y1 = region
    crop = rgb[y0:y1, x0:x1]
    ch, cw = crop.shape[:2]
    s = YOLO_SIZE / max(ch, cw)
    nh, nw = round(ch * s), round(cw * s)
    canvas = np.full((YOLO_SIZE, YOLO_SIZE, 3), 114, dtype=np.uint8)
    canvas[:nh, :nw] = cv2.resize(crop, (nw, nh), interpolation=cv2.INTER_AREA)
    blob = canvas.astype(np.float32).transpose(2, 0, 1)[None] / 255.0
    preds, protos = models.yolo.run(None, {"images": blob})
    preds = preds[0].T  # (8400, 4 + 1 + 32)
    scores = preds[:, 4]
    keep = scores > 0.25
    preds, scores = preds[keep], scores[keep]
    if len(preds) == 0:
        return []
    xywh = preds[:, :4]
    boxes = np.c_[xywh[:, 0] - xywh[:, 2] / 2, xywh[:, 1] - xywh[:, 3] / 2, xywh[:, 2], xywh[:, 3]]
    idx = cv2.dnn.NMSBoxes(boxes.tolist(), scores.tolist(), 0.25, 0.5)
    idx = np.array(idx).reshape(-1)
    proto = protos[0]  # (32, 160, 160)
    out = []
    for i in idx:
        coeff = preds[i, 5:]
        m = 1 / (1 + np.exp(-(coeff @ proto.reshape(32, -1)).reshape(160, 160)))
        m = cv2.resize(m, (YOLO_SIZE, YOLO_SIZE), interpolation=cv2.INTER_LINEAR)[:nh, :nw]
        m = cv2.resize(m, (cw, ch), interpolation=cv2.INTER_LINEAR)
        bx, by, bw, bh = boxes[i] / s
        box_mask = np.zeros_like(m, dtype=bool)
        box_mask[int(max(0, by)) : int(by + bh) + 1, int(max(0, bx)) : int(bx + bw) + 1] = True
        full = np.zeros(rgb.shape[:2], dtype=bool)
        full[y0:y1, x0:x1] = (m > 0.5) & box_mask
        if full.sum() < 20:
            continue
        out.append(NailCandidate(np.array([bx + x0, by + y0, bx + bw + x0, by + bh + y0]), full, float(scores[i])))
    return out


def hand_region(hand: HandDetection, shape: tuple[int, int], margin: float = 0.25) -> tuple[int, int, int, int]:
    pts = hand.landmarks
    x0, y0 = pts.min(0)
    x1, y1 = pts.max(0)
    pad = margin * max(x1 - x0, y1 - y0)
    return (
        int(max(0, x0 - pad)),
        int(max(0, y0 - pad)),
        int(min(shape[1], x1 + pad)),
        int(min(shape[0], y1 + pad)),
    )


# --------------------------------------------------------------------------- SAM refinement


def sam_embed(models: Models, crop: np.ndarray) -> tuple[np.ndarray, float]:
    """Encodes an image for SAM. Returns the embedding and the resize factor used."""
    s = SAM_SIZE / max(crop.shape[:2])
    resized = cv2.resize(crop, (round(crop.shape[1] * s), round(crop.shape[0] * s)), interpolation=cv2.INTER_LINEAR)
    return models.encoder.run(None, {"input_image": resized.astype(np.float32)})[0], s


def sam_decode(models: Models, emb: np.ndarray, s: float, size: tuple[int, int], points, labels):
    """Masks (3-4 candidates, at `size`) and their predicted IoU for one prompt."""
    coords = np.array([[[x * s, y * s] for x, y in points] + [[0.0, 0.0]]], dtype=np.float32)
    labs = np.array([list(labels) + [-1]], dtype=np.float32)
    masks, ious, _ = models.decoder.run(
        None,
        {
            "image_embeddings": emb,
            "point_coords": coords,
            "point_labels": labs,
            "mask_input": np.zeros((1, 1, 256, 256), dtype=np.float32),
            "has_mask_input": np.zeros(1, dtype=np.float32),
            "orig_im_size": np.array(size, dtype=np.float32),
        },
    )
    return masks[0] > 0.0, ious[0]


def _sam_masks(models: Models, crop: np.ndarray, points, labels):
    emb, s = sam_embed(models, crop)
    return sam_decode(models, emb, s, crop.shape[:2], points, labels)


def _iou(a: np.ndarray, b: np.ndarray) -> float:
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / union) if union else 0.0


def _main_component(mask: np.ndarray) -> np.ndarray:
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8))
    if n <= 1:
        return mask
    biggest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return labels == biggest


def _contour(mask: np.ndarray) -> np.ndarray:
    contours, _ = cv2.findContours(mask.astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    c = max(contours, key=cv2.contourArea).reshape(-1, 2).astype(np.float64)
    return fourier_smooth(c)


def fourier_smooth(contour: np.ndarray, harmonics: int = 6, samples: int = 256) -> np.ndarray:
    """Keeps only the lowest `harmonics` frequencies of a closed contour.

    Nails are smooth convex-ish shapes, so this removes pixel stair-steps and mask noise while
    keeping width and overall shape (a pure low-pass does not shrink the outline).
    """
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(np.vstack([contour, contour[:1]]), axis=0).T))]
    t = np.linspace(0, d[-1], samples, endpoint=False)
    closed = np.vstack([contour, contour[:1]])
    z = np.interp(t, d, closed[:, 0]) + 1j * np.interp(t, d, closed[:, 1])
    f = np.fft.fft(z)
    f[harmonics + 1 : samples - harmonics] = 0
    s = np.fft.ifft(f)
    return np.stack([s.real, s.imag], axis=1)


def refine_nail(models: Models, rgb: np.ndarray, coarse: np.ndarray, up: np.ndarray, finger: int) -> NailDetection:
    """Re-traces a coarse nail mask with SAM on an upright crop where the nail is ~40% of the frame."""
    ys, xs = np.nonzero(coarse)
    centre = np.array([xs.mean(), ys.mean()])
    extent = max(xs.max() - xs.min(), ys.max() - ys.min())
    out_size = 512
    k = out_size / (extent * 2.6)
    angle = math.degrees(math.atan2(up[1], up[0])) + 90  # rotate `up` onto (0, -1)
    rot = cv2.getRotationMatrix2D((float(centre[0]), float(centre[1])), angle, k)
    rot[:, 2] += np.array([out_size / 2, out_size / 2]) - centre
    crop = cv2.warpAffine(rgb, rot, (out_size, out_size), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
    coarse_crop = cv2.warpAffine(coarse.astype(np.uint8), rot, (out_size, out_size), flags=cv2.INTER_NEAREST) > 0
    inv = cv2.invertAffineTransform(rot)

    cy, cx = np.nonzero(coarse_crop)
    box = (cx.min(), cy.min(), cx.max(), cy.max())
    c = (cx.mean(), cy.mean())
    masks, ious = _sam_masks(models, crop, [c, (box[0], box[1]), (box[2], box[3])], [1, 2, 3])

    best_iou, best = 0.0, None
    for m, q in zip(masks, ious):
        m = _main_component(m)
        agreement = _iou(m, coarse_crop)
        if agreement * (0.5 + 0.5 * float(q)) > best_iou:
            best_iou, best = agreement * (0.5 + 0.5 * float(q)), (m, agreement)

    reasons: list[str] = []
    if best is None or best[1] < 0.6:
        # SAM disagrees with the detector: keep the detector's own (coarser) outline.
        mask, conf = coarse_crop, 0.5
        reasons.append("coarse-outline")
    else:
        mask, conf = best[0], best[1]
    contour = _contour(mask)
    if (contour[:, 0].min() <= 1 or contour[:, 1].min() <= 1 or contour[:, 0].max() >= out_size - 2
            or contour[:, 1].max() >= out_size - 2):
        reasons.append("touches-crop-edge")
        conf *= 0.5
    back = np.c_[contour, np.ones(len(contour))] @ inv.T
    return NailDetection(finger, back, up, float(conf), reasons)


# --------------------------------------------------------------------------- per hand


def find_nails(models: Models, rgb: np.ndarray, hand: HandDetection) -> dict[int, NailDetection]:
    """Assigns detected nails to the hand's fingers and refines each one."""
    candidates = detect_nail_candidates(models, rgb, hand_region(hand, rgb.shape[:2]))
    result: dict[int, NailDetection] = {}
    used: set[int] = set()
    for finger, (dip_i, tip_i) in FINGER_JOINTS.items():
        dip, tip = hand.landmarks[dip_i], hand.landmarks[tip_i]
        seg = tip - dip
        seg_len = float(np.hypot(*seg))
        if seg_len < 5:
            continue
        up = seg / seg_len
        expected = dip + seg * 0.65
        best, best_d = None, math.inf
        for i, cand in enumerate(candidates):
            if i in used:
                continue
            ys, xs = np.nonzero(cand.mask)
            d = float(np.hypot(xs.mean() - expected[0], ys.mean() - expected[1]))
            if d < best_d:
                best, best_d = i, d
        if best is None or best_d > 0.7 * seg_len:
            continue
        used.add(best)
        nail = refine_nail(models, rgb, candidates[best].mask, up, finger)
        nail.confidence *= min(1.0, candidates[best].score / 0.6)
        result[finger] = nail
    return result


# --------------------------------------------------------------------------- outline helpers


def _smooth_closed(pts: np.ndarray, k: int) -> np.ndarray:
    if k <= 1:
        return pts
    kernel = np.ones(2 * k + 1) / (2 * k + 1)
    padded = np.concatenate([pts[-k:], pts, pts[:k]])
    return np.stack([np.convolve(padded[:, i], kernel, mode="valid") for i in range(2)], axis=1)


def resample_outline(contour: np.ndarray, tip_dir: np.ndarray, n: int = 32) -> np.ndarray:
    """Resamples a contour to `n` points: index 0 on the free edge, index n/2 on the cuticle.

    Both halves are spaced evenly by arc length, matching the outline format of @naily/core.
    """
    proj = contour @ tip_dir
    i_tip = int(np.argmax(proj))
    i_cut = int(np.argmin(proj))
    pts = np.roll(contour, -i_tip, axis=0)
    i_cut = (i_cut - i_tip) % len(contour)
    first = _resample_open(pts[: i_cut + 1], n // 2 + 1)[:-1]
    second = _resample_open(np.concatenate([pts[i_cut:], pts[:1]]), n // 2 + 1)[:-1]
    return np.concatenate([first, second])


def _resample_open(pts: np.ndarray, m: int) -> np.ndarray:
    d = np.r_[0, np.cumsum(np.hypot(*np.diff(pts, axis=0).T))]
    if d[-1] == 0:
        return np.repeat(pts[:1], m, axis=0)
    targets = np.linspace(0, d[-1], m)
    return np.stack([np.interp(targets, d, pts[:, 0]), np.interp(targets, d, pts[:, 1])], axis=1)
