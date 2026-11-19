// Receipt pictures: pure pixel packing, shared by the app window (draws the caption) and the main process (prints it).

/** 1 bit per dot, rows left to right, most significant bit first, 1 = black. `width` is in dots and a multiple of 8. */
export type ReceiptRaster = { width: number; height: number; data: Uint8Array };
export const RASTER_MAX_WIDTH = 832;
export const RASTER_MAX_HEIGHT = 1200;

/** Packs RGBA pixels into a 1-bit picture: dark and opaque pixels become black dots. */
export function rasterFromRgba(rgba: Uint8Array, width: number, height: number, threshold = 140, invert = false): ReceiptRaster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('Invalid receipt image');
  const paddedWidth = Math.ceil(width / 8) * 8;
  const rowBytes = paddedWidth / 8;
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const alpha = rgba[i + 3] / 255;
    const luma = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
    if ((luma < threshold) !== invert) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return { width: paddedWidth, height, data };
}

/** Centres a picture on a white strip as wide as the paper: raster commands ignore the printer's centring on many models. */
export function padRasterToWidth(raster: ReceiptRaster, targetWidth: number): ReceiptRaster {
  if (!Number.isInteger(targetWidth) || targetWidth < 8 || targetWidth % 8 !== 0 || targetWidth > RASTER_MAX_WIDTH) throw new Error('Invalid receipt image');
  if (raster.width >= targetWidth) return raster.width === targetWidth ? raster : cropRasterToWidth(raster, targetWidth);
  const rowBytes = raster.width / 8, targetBytes = targetWidth / 8;
  // Whole bytes keep the copy simple; the picture sits at most 7 dots off the exact centre.
  const offset = Math.floor((targetBytes - rowBytes) / 2);
  const data = new Uint8Array(targetBytes * raster.height);
  for (let y = 0; y < raster.height; y++) data.set(raster.data.subarray(y * rowBytes, (y + 1) * rowBytes), y * targetBytes + offset);
  return { width: targetWidth, height: raster.height, data };
}

/** Keeps the middle part when a logo made for wide paper is printed on narrow paper. */
function cropRasterToWidth(raster: ReceiptRaster, targetWidth: number): ReceiptRaster {
  const rowBytes = raster.width / 8, targetBytes = targetWidth / 8;
  const offset = Math.floor((rowBytes - targetBytes) / 2);
  const data = new Uint8Array(targetBytes * raster.height);
  for (let y = 0; y < raster.height; y++) data.set(raster.data.subarray(y * rowBytes + offset, y * rowBytes + offset + targetBytes), y * targetBytes);
  return { width: targetWidth, height: raster.height, data };
}

/**
 * Electron's toBitmap() gives BGRA with the colour already multiplied by alpha. This returns plain RGBA, so a transparent edge
 * becomes white (not black) once the picture is reduced to black and white.
 */
export function rgbaFromPremultipliedBgra(bgra: Uint8Array): Uint8Array {
  if (bgra.length % 4 !== 0) throw new Error('Invalid receipt image');
  const rgba = new Uint8Array(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    const alpha = bgra[i + 3];
    const lift = (value: number) => alpha === 0 ? 255 : Math.min(255, Math.round(value * 255 / alpha));
    rgba[i] = lift(bgra[i + 2]); rgba[i + 1] = lift(bgra[i + 1]); rgba[i + 2] = lift(bgra[i]); rgba[i + 3] = alpha;
  }
  return rgba;
}

/**
 * Share of the picture that would print black. A logo that is mostly dark (a light mark on a dark square) prints as a heavy black
 * block on thermal paper, so callers can flip it to dark-on-white when this is over half.
 */
export function darkRatio(rgba: Uint8Array, threshold = 140): number {
  if (rgba.length === 0 || rgba.length % 4 !== 0) return 0;
  let dark = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3] / 255;
    const luma = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
    if (luma < threshold) dark++;
  }
  return dark / (rgba.length / 4);
}

/** Above this share of dark dots a logo is flipped to dark-on-white. */
export const LOGO_INVERT_ABOVE = 0.55;
