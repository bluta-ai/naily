import numpy as np

from naily_vision.nails import HandDetection, is_back_of_hand, resample_outline


def test_resample_puts_tip_first_and_cuticle_in_the_middle():
    a = np.linspace(0, 2 * np.pi, 200, endpoint=False)
    contour = np.stack([100 + 30 * np.sin(a), 200 - 40 * np.cos(a)], axis=1)  # tip at the top (y = 160)
    pts = resample_outline(contour, np.array([0.0, -1.0]), 32)
    assert pts.shape == (32, 2)
    assert np.allclose(pts[0], [100, 160], atol=1)
    assert np.allclose(pts[16], [100, 240], atol=1)


def _hand(thumb_side: int) -> HandDetection:
    # Fingers pointing up (y decreasing); index knuckle on the thumb's side.
    lm = np.zeros((21, 2))
    lm[0] = [0, 100]
    lm[9] = [0, 0]
    lm[5] = [30 * thumb_side, 0]
    lm[17] = [-30 * thumb_side, 0]
    axis, across = lm[9] - lm[0], lm[17] - lm[5]
    chirality = 1 if axis[0] * across[1] - axis[1] * across[0] > 0 else -1
    return HandDetection(lm, 1.0, chirality)


def test_back_of_left_hand_has_thumb_on_the_right():
    assert is_back_of_hand(_hand(+1), "L")
    assert not is_back_of_hand(_hand(+1), "R")
    assert is_back_of_hand(_hand(-1), "R")
