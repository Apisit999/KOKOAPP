// Canon EOS Webcam Utility keeps sending a dark, perfectly still "camera not
// connected" picture when the camera is unplugged or held by another app.
// A real camera always has some sensor noise between frames, even in the dark.

const DARK_LUMA = 40;
const STILL_DIFF = 0.3;

export function looksLikeNoSignal(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  let luma = 0;
  let diff = 0;
  for (let i = 0; i < a.length; i += 4) {
    luma += a[i] + a[i + 1] + a[i + 2];
    diff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  const pixels = (a.length / 4) * 3;
  return luma / pixels < DARK_LUMA && diff / pixels < STILL_DIFF;
}

export async function videoLooksLikeNoSignal(video: HTMLVideoElement): Promise<boolean> {
  if (!video.videoWidth || !video.videoHeight) return false;
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 90;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return false;
  const grab = () => { context.drawImage(video, 0, 0, canvas.width, canvas.height); return context.getImageData(0, 0, canvas.width, canvas.height).data; };
  const first = grab();
  await new Promise(resolve => setTimeout(resolve, 300));
  return looksLikeNoSignal(first, grab());
}
