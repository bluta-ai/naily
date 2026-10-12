# Naily · 甲印

Nails made to fit you exactly. Customers take **4 photos with their phone** (no dragging, no
typing sizes); we measure every nail automatically and make press-on nails or nail wraps that fit.

```
Left hand ─► Left thumb ─► Right hand ─► Right thumb ─► ✓ Sizes ─► Pick a design ─► Address ─► Order
   (each: one big "Take photo" button → "✓ Found 4 nails" or a plain-language "try again")
```

Built for everyone, including customers over 50: one action per screen, large text and buttons,
pictures showing what to do, the phone's own camera app, friendly fixes instead of error codes,
English and 中文.

## How the automatic measuring works

Each photo shows one hand (the other holds the phone) with any bank card beside it.

| Step | How | Where |
| --- | --- | --- |
| Find the card | Edge contours → card-shaped quads; falls back to Segment Anything if the table is busy. Each side is then located to sub-pixel accuracy and the straight edges are intersected, so the rounded corners don't matter. | `apps/vision/naily_vision/card.py` |
| Find the fingers | Google MediaPipe hand landmarks: which finger is which, and whether we see the back of the hand or the palm. | `nails.py` |
| Find the nails | A YOLOv8 nail segmenter finds each nail; MobileSAM re-traces it on an upright, zoomed crop for sharp edges; a Fourier low-pass smooths the outline. | `nails.py` |
| Pixels → millimetres | The card (85.60 × 53.98 mm) gives a perspective-correct mapping onto the table. Nails sit ~9 mm above the table (closer to the camera), so they are scaled down using the camera height worked out from the card size and the lens (EXIF). | `packages/core/src/scan.ts` |
| Shape and size | Width, length, shape (square / squoval / round / oval / almond / stiletto) and press-on size. | `packages/core/src/nail.ts` |

If a photo can't be used the customer gets one sentence telling them what to change ("turn your
hand over", "we can't see the card", "this looks like your other hand", "hold the phone still"…).
After two failed tries they may skip; that finger is mirrored from the other hand.

**Privacy:** photos are processed in memory and never stored. Only the nail outlines (mm) are kept.

### Tested so far

On 62 real hand photos (the public "11k Hands" dataset) with a bank card added in:

- Back of hand: all 4 finger nails found on ~93% of photos, thumb on ~90%.
- Palm-up photos: always rejected with "turn your hand over".
- Card corners: median error 0.7 px (≈0.15 mm), found in 57/62 photos; the misses all had the
  card touching the hand, which the app tells the customer to avoid.
- Pipeline unit tests check that a 14 mm nail photographed from 25 cm measures 14.0 mm.

**Still to do before launch:** test with ~50 real customers' phone photos (various phones, light,
skin tones, nail polish), compare against tape-measured sizes, and tune. Nails are curved, so the
photo gives the straight-across width; a curvature allowance should be calibrated from test prints.

## Layout

| Path | What |
| --- | --- |
| `packages/core` | Pure TypeScript: calibration, measurement, height correction, patterns, design presets, print sheet, order validation, pricing. Reusable by a WeChat mini program. |
| `apps/web` | Mobile React + Vite site. |
| `apps/server` | Express API + SQLite (`node:sqlite`): `/api/scan`, orders, admin, print files. |
| `apps/vision` | Python scanner (FastAPI, MediaPipe, ONNX Runtime, OpenCV). |

## Run it locally

You need **Node.js 22.5+** and **Python 3.11–3.13**.

```bash
npm install

# Vision service (first time only: download models, ~100 MB)
cd apps/vision
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python fetch_models.py
cd ../..
```

Then three terminals (Windows: same commands; PowerShell may need `npm.cmd` instead of `npm`):

```bash
npm run vision                     # 1. scanner on :8790 (with the venv activated)
npm run dev -w @naily/server       # 2. API on :8787
npm run dev -w @naily/web          # 3. website on :5173
```

Open http://localhost:5173. On a phone the camera needs HTTPS: run
`cloudflared tunnel --url http://localhost:5173` and open the printed link.

On Linux the scanner needs `libegl1 libgles2 libgl1` (`sudo apt install libegl1 libgles2 libgl1`).

### With Docker (production)

```bash
echo "ADMIN_TOKEN=change-me" > .env
docker compose up --build          # site + API on :8787, scanner inside
```

### Put it online (free): Hugging Face Spaces

```bash
pip install huggingface_hub
python apps/vision/fetch_models.py
HF_TOKEN=hf_xxx python deploy/huggingface/deploy.py <hf-username>/naily --admin-token change-me
```

The Space builds one container with everything (`deploy/huggingface/Dockerfile`, ~5–10 min) and
is then live at `https://<hf-username>-naily.hf.space`. Note: hf.space is not reachable from
mainland China without a VPN; for customers there, host on Tencent Cloud / Alibaba Cloud with the
same Dockerfile.

### Put it online without a server: Claude Artifact

The same site can run entirely on the phone: the scanner is ported to the browser
(`apps/web/src/scanner/`, ONNX Runtime Web + MediaPipe + OpenCV.js) and orders go to the
Artifact's database. It gives the same measurements as the server (checked to within 0.1 mm),
downloads ~130 MB the first time, and measures in ~10–15 s per photo on a fast phone.

```bash
python apps/vision/export_browser_models.py --full   # models → apps/web/public-artifact/models
npm run build:artifact -w @naily/web                 # → apps/web/dist-artifact (publish naily.html + files)
```

### Tests

```bash
npm test                                         # core + server
cd apps/vision && pip install -r requirements-dev.txt && pytest
NAILY_SAMPLE=photo.jpg pytest                    # also scan a real photo of a left hand + card
```

## API

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/scan?step=left-hand\|left-thumb\|right-hand\|right-thumb` | Photo as the body. Returns nails in mm, or `{ ok: false, problem }`. |
| `POST` | `/api/orders` | Create an order. Returns id, status, price. |
| `GET` | `/api/orders/:id` | Public status. |
| `GET` | `/api/admin/orders` | All orders. `Authorization: Bearer $ADMIN_TOKEN` |
| `GET` | `/api/admin/orders/:id/sheet.svg` | **Print file at 1:1 scale** with red cut lines. |
| `PATCH` | `/api/admin/orders/:id` | `{ "status": "shipped", "trackingNumber": "SF123" }` |

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8787` | |
| `VISION_URL` | `http://127.0.0.1:8790` | Where the scanner runs |
| `NAILY_DB` | `apps/server/data/naily.sqlite` | |
| `ADMIN_TOKEN` | unset | Admin endpoints are disabled until set |
| `NAILY_MODELS` | `apps/vision/models` | Scanner model folder |

## Models and licences

| Model | Licence |
| --- | --- |
| MediaPipe Hand Landmarker (Google) | Apache-2.0 |
| MobileSAM (ONNX export by Acly) | Apache-2.0 |
| `mnemic/nails_seg_yolov8` nail segmenter | CC-BY-4.0 weights, trained with Ultralytics YOLOv8 (**AGPL-3.0**) |

The app runs the YOLO model with ONNX Runtime only, but Ultralytics considers models trained with
YOLOv8 to fall under AGPL-3.0. **Before selling, buy an Ultralytics licence or replace this one
model** with an Apache-licensed detector trained on our own (consented) customer photos, which
will also make it more accurate.

## Roadmap

- **WeChat mini program**: the same 4-photo flow with `wx.chooseMedia`, calling `/api/scan`.
- **Payments**: WeChat Pay / Alipay.
- **Live camera guidance**: tell the customer "move closer" / "card not visible" before they press the button.
- **Staff help**: if photos keep failing, send them (with consent) to the workshop to measure by hand.
- Nail curvature allowance from test prints; admin dashboard UI.
