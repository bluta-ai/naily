"""Card detection on generated photos: no models needed."""

import cv2
import numpy as np
import pytest

from naily_vision.card import CARD_RATIO, detect_card


def photo_with_card(angle_deg: float, background: int, seed: int = 0):
    rng = np.random.default_rng(seed)
    img = np.clip(rng.normal(background, 10, (1200, 1600, 3)), 0, 255).astype(np.uint8)
    w, h = 430.0, 430.0 / CARD_RATIO
    a = np.deg2rad(angle_deg)
    rot = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    corners = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]) @ rot.T + [900, 700]
    card = np.zeros(img.shape[:2], np.uint8)
    cv2.fillPoly(card, [np.round(corners * 16).astype(np.int32)], 255, lineType=cv2.LINE_AA, shift=4)
    colour = np.array([40, 90, 170], np.float32)
    alpha = (card / 255.0)[..., None]
    img = (img * (1 - alpha) + colour * alpha).astype(np.uint8)
    return img, corners


@pytest.mark.parametrize("angle,background", [(0, 200), (17, 120), (-35, 60), (80, 230)])
def test_finds_card_corners_to_a_pixel(angle, background):
    img, truth = photo_with_card(angle, background)
    found = detect_card(img)
    assert found is not None
    err = min(np.abs(np.roll(found.corners, r, 0) - t).max() for t in (truth, truth[::-1]) for r in range(4))
    assert err < 1.5


def test_ignores_quads_containing_the_hand():
    img, truth = photo_with_card(10, 180)
    assert detect_card(img, avoid=[truth.mean(0, keepdims=True)]) is None


def test_no_card_no_answer():
    rng = np.random.default_rng(1)
    assert detect_card(np.clip(rng.normal(128, 20, (900, 1200, 3)), 0, 255).astype(np.uint8)) is None
