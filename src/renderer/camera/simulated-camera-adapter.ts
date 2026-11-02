import { CameraError, type CameraAdapter, type CameraCapabilities, type CameraDevice, type CameraStatus } from './camera-adapter.ts';

export const SIMULATED_CAMERA_ID = 'koko-simulated-camera';
const WIDTH = 1280;
const HEIGHT = 720;

/**
 * Test-only camera that draws a synthetic scene. It exists so the capture flow can be exercised
 * without any camera attached. It never claims to be real hardware: the label and sourceKind say so.
 */
export class SimulatedCameraAdapter implements CameraAdapter {
  readonly capabilities: CameraCapabilities = {
    sourceKind: 'simulated', livePreview: true, stillCapture: 'video-frame', remoteShutter: false
  };
  private readonly timers = new Map<MediaStream, ReturnType<typeof setInterval>>();
  private frame = 0;

  async enumerateDevices(): Promise<CameraDevice[]> {
    return [{ deviceId: SIMULATED_CAMERA_ID, label: 'Simulated camera (sample image, not real hardware)' }];
  }

  async connect(deviceId?: string): Promise<MediaStream> {
    if (deviceId && deviceId !== SIMULATED_CAMERA_ID) throw new CameraError('not-found');
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const context = canvas.getContext('2d');
    if (!context || typeof canvas.captureStream !== 'function') throw new CameraError('unknown');
    const draw = () => this.drawFrame(context, this.frame++);
    draw();
    const stream = canvas.captureStream(15);
    this.timers.set(stream, setInterval(draw, 1000 / 15));
    return stream;
  }

  disconnect(stream: MediaStream) {
    const timer = this.timers.get(stream);
    if (timer) clearInterval(timer);
    this.timers.delete(stream);
    stream.getTracks().forEach(track => track.stop());
  }

  async startPreview(stream: MediaStream, video: HTMLVideoElement) {
    video.srcObject = stream;
    await video.play();
  }

  stopPreview(video: HTMLVideoElement) {
    video.pause();
    video.srcObject = null;
  }

  async captureStill(stream: MediaStream, video: HTMLVideoElement): Promise<Blob> {
    if (!stream.active || video.srcObject !== stream || !video.videoWidth || !video.videoHeight) throw new CameraError('unknown');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new CameraError('unknown');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new CameraError('unknown')), 'image/jpeg', 0.92));
  }

  getStatus(): CameraStatus { return 'searching'; }

  onDevicesChanged() { return () => undefined; }

  private drawFrame(context: CanvasRenderingContext2D, frame: number) {
    const hue = (frame * 2) % 360;
    const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
    gradient.addColorStop(0, `hsl(${hue}, 60%, 55%)`);
    gradient.addColorStop(1, `hsl(${(hue + 80) % 360}, 60%, 35%)`);
    context.fillStyle = gradient;
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.beginPath();
    context.arc(WIDTH / 2 + Math.sin(frame / 15) * 220, HEIGHT / 2, 120, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#fff';
    context.font = 'bold 48px sans-serif';
    context.textAlign = 'center';
    context.fillText('SIMULATED CAMERA', WIDTH / 2, 90);
    context.font = '28px sans-serif';
    context.fillText(`frame ${frame}`, WIDTH / 2, HEIGHT - 50);
  }
}
