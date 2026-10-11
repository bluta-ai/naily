"""Finds the bank card (ISO/IEC 7810 ID-1, 85.60 × 53.98 mm) used as the scale reference.

Classic geometry, no model: edge maps → quadrilateral contours → score by card-like aspect ratio
and solidity → refine each side with a line fit so the rounded corners do not pull the corners in.
The returned corners are where the straight edges meet, i.e. the full 85.60 × 53.98 mm rectangle.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

CARD_RATIO = 85.60 / 53.98
WORK_SIZE = 1200


@dataclass
class CardDetection:
    corners: np.ndarray  # (4, 2) pixels, clockwise starting top-left
    score: float


def _order(quad: np.ndarray) -> np.ndarray:
    c = quad.mean(0)
    ang = np.arctan2(quad[:, 1] - c[1], quad[:, 0] - c[0])
    q = quad[np.argsort(ang)]  # clockwise in y-down coordinates
    start = int(np.argmin(q.sum(1)))
    return np.roll(q, -start, axis=0)


def _edge_maps(img: np.ndarray):
    lab = cv2.cvtColor(img, cv2.COLOR_RGB2LAB)
    hsv = cv2.cvtColor(img, cv2.COLOR_RGB2HSV)
    for ch in (lab[:, :, 0], lab[:, :, 1], lab[:, :, 2], hsv[:, :, 1]):
        blur = cv2.GaussianBlur(ch, (5, 5), 0)
        med = float(np.median(blur))
        for lo_k, hi_k in ((0.66, 1.33), (0.33, 0.8)):
            lo, hi = max(5, lo_k * med), max(20, hi_k * med)
            if hi - lo < 10:
                lo, hi = 10, 40
            edges = cv2.Canny(blur, lo, hi)
            yield cv2.morphologyEx(edges, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))


def _side_ratio(q: np.ndarray) -> float:
    s = [np.hypot(*(q[(i + 1) % 4] - q[i])) for i in range(4)]
    a, b = (s[0] + s[2]) / 2, (s[1] + s[3]) / 2
    return max(a, b) / max(1e-6, min(a, b))


def _refine_edges(img: np.ndarray, quad: np.ndarray) -> np.ndarray | None:
    """Sub-pixel corners: for each side, find the strongest colour step along normals, fit a line.

    `img` must be the full-resolution image (float Lab), `quad` a rough card outline on it.
    """
    h, w = img.shape[:2]
    lines = []
    for i in range(4):
        a, b = quad[i], quad[(i + 1) % 4]
        d = b - a
        length = float(np.hypot(*d))
        u = d / length
        n = np.array([-u[1], u[0]])
        reach = max(6.0, 0.04 * length)
        offsets = np.arange(-reach, reach + 0.5, 0.5)
        found = []
        for t in np.linspace(0.12, 0.88, 60):
            p = a + d * t
            xy = p[None, :] + offsets[:, None] * n[None, :]
            if xy[:, 0].min() < 1 or xy[:, 1].min() < 1 or xy[:, 0].max() > w - 2 or xy[:, 1].max() > h - 2:
                continue
            prof = cv2.remap(img, xy[:, 0].astype(np.float32).reshape(1, -1), xy[:, 1].astype(np.float32).reshape(1, -1),
                             cv2.INTER_LINEAR).reshape(-1, 3)
            grad = np.linalg.norm(prof[2:] - prof[:-2], axis=1)
            k = int(np.argmax(grad))
            if grad[k] < 6:
                continue
            # Parabolic interpolation around the peak for sub-sample precision.
            off = 0.0
            if 0 < k < len(grad) - 1:
                y0, y1, y2 = grad[k - 1], grad[k], grad[k + 1]
                den = y0 - 2 * y1 + y2
                off = 0.5 * (y0 - y2) / den if den != 0 else 0.0
            found.append(xy[k + 1] + n * off * 0.5)
        if len(found) < 15:
            return None
        pts = np.array(found, dtype=np.float32)
        # Two passes: fit, drop points far from the line (text, shadows, fingers), refit.
        for _ in range(2):
            vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_HUBER, 0, 0.01, 0.01).reshape(-1)
            dist = np.abs((pts[:, 0] - x0) * vy - (pts[:, 1] - y0) * vx)
            keep = dist < max(1.5, np.median(dist) * 3)
            if keep.sum() < 12:
                return None
            pts = pts[keep]
        lines.append((np.array([x0, y0], dtype=np.float64), np.array([vx, vy], dtype=np.float64)))
    out = []
    for i in range(4):
        (p1, d1), (p2, d2) = lines[i - 1], lines[i]
        m = np.array([d1, -d2]).T
        if abs(np.linalg.det(m)) < 1e-6:
            return None
        sol = np.linalg.solve(m, p2 - p1)
        out.append(p1 + sol[0] * d1)
    return np.array(out)


def _quad_from_mask(mask: np.ndarray) -> tuple[float, np.ndarray] | None:
    """A card-shaped quad from a segment mask, or None if the segment is not card-like."""
    m = mask.astype(np.uint8)
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    c = max(contours, key=cv2.contourArea)
    area = cv2.contourArea(c)
    hull = cv2.convexHull(c)
    approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True).reshape(-1, 2)
    if len(approx) != 4:
        return None
    quad = _order(approx.astype(np.float64))
    ratio = _side_ratio(quad)
    solidity = area / max(1.0, cv2.contourArea(quad.astype(np.float32)))
    if abs(ratio - CARD_RATIO) / CARD_RATIO > 0.3 or solidity < 0.9:
        return None
    return (1 - abs(ratio - CARD_RATIO) / CARD_RATIO) * solidity, quad


def sam_card_candidates(segment, shape: tuple[int, int], avoid: list[np.ndarray]) -> list[tuple[float, np.ndarray]]:
    """Prompts a segmenter on a grid of points and keeps card-shaped segments.

    `segment(points, labels)` returns (masks, scores) at image size — e.g. SAM decoding.
    """
    h, w = shape
    out: list[tuple[float, np.ndarray]] = []
    covered = np.zeros(shape, dtype=bool)
    for gy in np.linspace(0.08, 0.92, 8):
        for gx in np.linspace(0.06, 0.94, 10):
            x, y = gx * w, gy * h
            if covered[int(y), int(x)]:
                continue
            masks, scores = segment([(x, y)], [1])
            for m, q in zip(masks, scores):
                frac = m.mean()
                if frac < 0.01 or frac > 0.5 or q < 0.7:
                    continue
                found = _quad_from_mask(m)
                if found is None:
                    continue
                score, quad = found
                if any(cv2.pointPolygonTest(quad.astype(np.float32), (float(px), float(py)), False) >= 0 for p in avoid for px, py in p):
                    continue
                covered |= m
                out.append((score + 0.2 * float(np.sqrt(frac)), quad))
    return out


def detect_card(rgb: np.ndarray, avoid: list[np.ndarray] | None = None, segment=None) -> CardDetection | None:
    """Finds the card. `avoid`: point sets (e.g. hand landmarks) that must not fall inside it.

    `segment` (optional) is a SAM-style prompt function used when edge contours find nothing.
    """
    h, w = rgb.shape[:2]
    s = min(1.0, WORK_SIZE / max(h, w))
    img = cv2.resize(rgb, (round(w * s), round(h * s)), interpolation=cv2.INTER_AREA) if s < 1 else rgb
    area_img = img.shape[0] * img.shape[1]
    avoid_pts = [p * s for p in (avoid or [])]

    rough: list[tuple[float, np.ndarray]] = []
    for edges in _edge_maps(img):
        contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)
        for c in contours:
            area = cv2.contourArea(c)
            if area < 0.01 * area_img or area > 0.6 * area_img:
                continue
            hull = cv2.convexHull(c)
            approx = cv2.approxPolyDP(hull, 0.02 * cv2.arcLength(hull, True), True).reshape(-1, 2)
            if len(approx) != 4 or not cv2.isContourConvex(approx.reshape(-1, 1, 2)):
                continue
            quad = _order(approx.astype(np.float64))
            ratio = _side_ratio(quad)
            if abs(ratio - CARD_RATIO) / CARD_RATIO > 0.3:
                continue
            solidity = area / max(1.0, cv2.contourArea(quad.astype(np.float32)))
            if solidity < 0.85:
                continue
            if any(cv2.pointPolygonTest(quad.astype(np.float32), (float(x), float(y)), False) >= 0 for p in avoid_pts for x, y in p):
                continue
            score = (1 - abs(ratio - CARD_RATIO) / CARD_RATIO) * min(1.0, solidity) + 0.2 * np.sqrt(area / area_img)
            rough.append((float(score), quad / s))
    result = _best_refined(rgb, rough, s)
    if result is None and segment is not None:
        result = _best_refined(rgb, sam_card_candidates(segment, rgb.shape[:2], avoid or []), 1.0)
    return result


def _best_refined(rgb: np.ndarray, rough: list[tuple[float, np.ndarray]], s: float) -> CardDetection | None:
    rough.sort(key=lambda r: -r[0])
    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB).astype(np.float32)
    best: tuple[float, np.ndarray] | None = None
    seen: list[np.ndarray] = []
    for score, quad in rough:
        if any(np.abs(quad - q).max() < 4 / s for q in seen):
            continue  # the same card found in another edge map
        seen.append(quad)
        if len(seen) > 6:
            break
        refined = _refine_edges(lab, quad)
        if refined is None:
            continue
        refined = _order(refined)
        if abs(_side_ratio(refined) - CARD_RATIO) / CARD_RATIO > 0.3 or np.abs(refined - quad).max() > 0.1 * np.ptp(quad[:, 0]):
            continue
        if best is None or score > best[0]:
            best = (score, refined)
    if best is None:
        return None
    return CardDetection(best[1], min(1.0, best[0]))
