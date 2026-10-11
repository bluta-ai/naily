# Naily · 甲印

Custom-fit nails, measured by your phone.

Customers photograph their hands next to a bank card, mark each nail outline, choose a design,
and order. We print the design clipped to **their exact nail shapes at true millimetre scale**
and ship press-on nails or nail wraps.

```
Photos ──► Mark card + nails ──► Sizes ──► Design ──► Order ──► Factory print sheet (1:1 SVG)
```

## How the measuring works

1. **Scale reference.** Every bank, transit or ID card is ISO/IEC 7810 ID-1: 85.60 × 53.98 mm.
   The customer marks its four corners, and we solve a **homography** (a projective transform)
   from image pixels to millimetres on the table. That fixes scale and also undoes the tilt
   of a hand-held phone (`packages/core/src/calibration.ts`).
2. **Nail outline.** Each nail is 8 draggable control points (tip, cuticle, sides) smoothed with
   a Catmull-Rom spline. A magnifier loupe shows up while dragging so it can be placed precisely
   on a phone.
3. **Measurement.** The outline is mapped to mm and rotated into the nail's own frame
   (cuticle→tip vertical, always a rotation, never a mirror image). From that we get width,
   length, area, free-edge shape (square / squoval / round / oval / almond / stiletto) and a
   standard press-on size 0–11 (`packages/core/src/nail.ts`).
4. **Missing fingers** are mirrored from the same finger on the other hand and flagged `*`.

**Privacy:** photos never leave the phone. The server only receives the nail outlines in mm.

## Layout

| Path | What |
| --- | --- |
| `packages/core` | Pure TypeScript, no DOM: homography, calibration, nail measurement, pattern library, print-sheet SVG, order validation and pricing. Shared by the web app, the server, and a future WeChat mini program. |
| `apps/web` | Mobile-first React + Vite site (English / 中文). Camera capture with `getUserMedia`, upload fallback. |
| `apps/server` | Express API + SQLite (`node:sqlite`, no native build). Validates orders, computes prices server-side, and renders the factory print sheet. |

## Run it

Requires Node 22.5+.

```bash
npm install
npm run dev        # API on :8787, web on :5173 (proxied /api)
npm test           # core + server tests
npm run typecheck
```

Production:

```bash
npm run build
ADMIN_TOKEN=change-me npm start   # serves the built site + API on :8787
```

The camera needs HTTPS (or `localhost`) — put the server behind a TLS proxy when testing on a phone.

### Environment

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8787` | |
| `NAILY_DB` | `apps/server/data/naily.sqlite` | `:memory:` for throwaway runs |
| `ADMIN_TOKEN` | unset | Admin endpoints are disabled until set |

## API

| Method | Path | |
| --- | --- | --- |
| `POST` | `/api/orders` | Create an order (nails in mm, design, shipping). Returns id, status, price. |
| `GET` | `/api/orders/:id` | Public status (no address or phone). |
| `GET` | `/api/admin/orders` | All orders. `Authorization: Bearer $ADMIN_TOKEN` |
| `GET` | `/api/admin/orders/:id/sheet.svg` | **Print file at 1:1 scale** (width/height in mm) with red cut lines, ready for a UV printer / cutter. Nail wraps are inset 0.5 mm so they never touch skin. |
| `PATCH` | `/api/admin/orders/:id` | `{ "status": "shipped", "trackingNumber": "SF123" }` |

## Patterns

Solid, French tip, Ombré, Polka dots, Stripes, Half moon, Chevron tip, Marble, Glitter fade —
each with editable colours, plus an optional accent on the ring fingers. Patterns are plain SVG
generated in `packages/core/src/patterns.ts`, so the browser preview and the factory file come
from the same code. Adding a pattern is one object in that array.

## Roadmap

- **WeChat mini program.** Reuse `@naily/core` as-is (it has no DOM dependencies); build the UI
  with Taro or native mini-program pages using `wx.chooseMedia` / `<camera>` and canvas for
  marking. Until then the website works inside WeChat's built-in browser.
- **Payments:** WeChat Pay / Alipay (orders are currently created unpaid as `received`).
- **Auto nail detection:** hand-landmark model to pre-place outlines, then edge snapping, so
  customers only fine-tune.
- **Card auto-detection** (quad detection) to skip manual corner marking.
- Nail curvature (C-curve) from a side photo for better press-on fit.
- Admin dashboard UI on top of the admin API; customer accounts and reorder history.
