/** Decoding photos in the browser, mirroring apps/vision/naily_vision/scan.py:load_photo. */

export interface Photo {
  /** RGB pixels, row-major, 3 bytes per pixel. */
  rgb: Uint8Array;
  width: number;
  height: number;
  focal35: number | null;
}

const MAX_SIDE = 2400;

export async function loadPhoto(file: Blob): Promise<Photo> {
  const focal35 = readFocal35(new DataView(await file.slice(0, 256 * 1024).arrayBuffer()));
  // createImageBitmap applies the EXIF rotation, like PIL's exif_transpose.
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const s = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * s);
  const height = Math.round(bitmap.height * s);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
    rgb[j] = rgba[i]!;
    rgb[j + 1] = rgba[i + 1]!;
    rgb[j + 2] = rgba[i + 2]!;
  }
  return { rgb, width, height, focal35 };
}

/** FocalLengthIn35mmFilm (EXIF tag 0xA405) from a JPEG, or null. */
export function readFocal35(view: DataView): number | null {
  try {
    if (view.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < view.byteLength) {
      const marker = view.getUint16(off);
      const len = view.getUint16(off + 2);
      if (marker === 0xffe1 && view.getUint32(off + 4) === 0x45786966) return readTiff(view, off + 10);
      if ((marker & 0xff00) !== 0xff00) return null;
      off += 2 + len;
    }
  } catch {
    // Truncated or unusual file: no EXIF.
  }
  return null;
}

function readTiff(view: DataView, tiff: number): number | null {
  const little = view.getUint16(tiff) === 0x4949;
  const u16 = (o: number) => view.getUint16(o, little);
  const u32 = (o: number) => view.getUint32(o, little);
  const findTag = (ifd: number, tag: number): number | null => {
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const e = ifd + 2 + i * 12;
      if (u16(e) === tag) return e;
    }
    return null;
  };
  const ifd0 = tiff + u32(tiff + 4);
  const exifPtr = findTag(ifd0, 0x8769);
  if (exifPtr === null) return null;
  const entry = findTag(tiff + u32(exifPtr + 8), 0xa405);
  if (entry === null) return null;
  const v = u16(entry + 8);
  return v > 0 ? v : null;
}
