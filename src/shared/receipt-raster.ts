// Receipt pictures: pure pixel packing, shared by the app window (draws the caption) and the main process (prints it).

/** 1 bit per dot, rows left to right, most significant bit first, 1 = black. `width` is in dots and a multiple of 8. */
export type ReceiptRaster = { width: number; height: number; data: Uint8Array };
export const RASTER_MAX_WIDTH = 832;
export const RASTER_MAX_HEIGHT = 1200;

/** Packs RGBA pixels into a 1-bit picture: dark and opaque pixels become black dots. */
export function rasterFromRgba(rgba: Uint8Array, width: number, height: number, threshold = 140): ReceiptRaster {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error('Invalid receipt image');
  const paddedWidth = Math.ceil(width / 8) * 8;
  const rowBytes = paddedWidth / 8;
  const data = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const alpha = rgba[i + 3] / 255;
    const luma = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
    if (luma < threshold) data[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
  }
  return { width: paddedWidth, height, data };
}
