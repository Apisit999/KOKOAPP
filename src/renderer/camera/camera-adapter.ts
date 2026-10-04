export type CameraDevice = { deviceId: string; label: string };
export type StillCaptureMode = 'none' | 'video-frame' | 'camera-original' | 'file-import';
export type CameraCapabilities = {
  sourceKind: 'video-input' | 'phone-network' | 'camera-sdk' | 'folder';
  livePreview: boolean;
  stillCapture: StillCaptureMode;
  remoteShutter: boolean;
};
export type CameraFailure = 'permission-denied' | 'not-found' | 'busy' | 'unknown';
export type CameraStatus = 'searching' | 'detected' | 'not-found' | 'connecting' | 'ready' | 'permission-denied' | 'busy' | 'disconnected' | 'error';

export class CameraError extends Error {
  readonly code: CameraFailure;
  constructor(code: CameraFailure) { super(code); this.code = code; }
}

/** A transport-specific camera implementation. Still capture is an optional capability. */
export interface CameraAdapter {
  readonly capabilities: CameraCapabilities;
  enumerateDevices(): Promise<CameraDevice[]>;
  connect(deviceId?: string): Promise<MediaStream>;
  disconnect(stream: MediaStream): void;
  startPreview(stream: MediaStream, video: HTMLVideoElement): Promise<void>;
  stopPreview(video: HTMLVideoElement): void;
  getStatus(): CameraStatus;
  onDevicesChanged(listener: () => void): () => void;
  captureStill?(stream: MediaStream, video: HTMLVideoElement): Promise<Blob>;
}

export class BrowserCameraAdapter implements CameraAdapter {
  readonly capabilities: CameraCapabilities = {
    sourceKind: 'video-input', livePreview: true, stillCapture: 'video-frame', remoteShutter: false
  };

  async enumerateDevices(): Promise<CameraDevice[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput').map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Camera ${index + 1}`
    }));
  }

  async connect(deviceId?: string): Promise<MediaStream> {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: deviceId ? { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } } : { width: { ideal: 1920 }, height: { ideal: 1080 } }
      });
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') throw new CameraError('permission-denied');
      if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new CameraError('not-found');
      if (name === 'NotReadableError' || name === 'AbortError') throw new CameraError('busy');
      throw new CameraError('unknown');
    }
  }

  disconnect(stream: MediaStream) { stream.getTracks().forEach(track => track.stop()); }

  async startPreview(stream: MediaStream, video: HTMLVideoElement) {
    video.srcObject = stream;
    await video.play();
  }

  stopPreview(video: HTMLVideoElement) {
    video.pause();
    video.srcObject = null;
  }

  async captureStill(stream: MediaStream, video: HTMLVideoElement): Promise<Blob> {
    // A live stream can report ready before the first decoded frame arrives.
    // Wait briefly for a usable frame instead of failing the whole round.
    const deadline = Date.now() + 2000;
    while (stream.active && video.srcObject === stream &&
      (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) && Date.now() < deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 50));
    }
    if (!stream.active || video.srcObject !== stream || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) throw new CameraError('unknown');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) throw new CameraError('unknown');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new CameraError('unknown')), 'image/jpeg', 0.94));
    return blob;
  }

  getStatus(): CameraStatus { return 'searching'; }

  onDevicesChanged(listener: () => void) {
    navigator.mediaDevices.addEventListener('devicechange', listener);
    return () => navigator.mediaDevices.removeEventListener('devicechange', listener);
  }
}

/** Owns camera discovery and stream lifecycle independently of the view. */
export class CameraManager {
  private stream: MediaStream | null = null;
  private status: CameraStatus = 'searching';
  private generation = 0;
  private readonly adapter: CameraAdapter;
  private pendingConnect: { deviceId?: string; promise: Promise<MediaStream | null> } | null = null;

  constructor(adapter: CameraAdapter) { this.adapter = adapter; }

  getStatus() { return this.status; }
  getStream() { return this.stream; }
  getCapabilities() { return this.adapter.capabilities; }

  async enumerateDevices() {
    if (!this.stream) this.status = 'searching';
    try {
      const devices = await this.adapter.enumerateDevices();
      if (!this.stream) this.status = devices.length ? 'detected' : 'not-found';
      return devices;
    } catch {
      if (!this.stream) this.status = 'error';
      throw new CameraError('unknown');
    }
  }

  connect(deviceId?: string): Promise<MediaStream | null> {
    if (this.pendingConnect && this.pendingConnect.deviceId === deviceId) return this.pendingConnect.promise;
    this.disconnect();
    const generation = ++this.generation;
    this.status = 'connecting';
    const promise = this.connectGeneration(deviceId, generation);
    this.pendingConnect = { deviceId, promise };
    void promise.then(() => {
      if (this.pendingConnect?.promise === promise) this.pendingConnect = null;
    }, () => {
      if (this.pendingConnect?.promise === promise) this.pendingConnect = null;
    });
    return promise;
  }

  private async connectGeneration(deviceId: string | undefined, generation: number): Promise<MediaStream | null> {
    try {
      const stream = await this.adapter.connect(deviceId);
      if (generation !== this.generation) { this.adapter.disconnect(stream); return null; }
      this.stream = stream;
      this.status = 'ready';
      return stream;
    } catch (error) {
      if (generation !== this.generation) return null;
      const code = error instanceof CameraError ? error.code : 'unknown';
      this.status = code === 'permission-denied' ? 'permission-denied' : code === 'not-found' ? 'not-found' : code === 'busy' ? 'busy' : 'error';
      throw error;
    }
  }

  disconnect() {
    this.generation++;
    this.pendingConnect = null;
    if (this.stream) this.adapter.disconnect(this.stream);
    this.stream = null;
    this.status = 'disconnected';
  }

  async startPreview(video: HTMLVideoElement, expectedStream = this.stream) {
    if (!expectedStream || expectedStream !== this.stream || !expectedStream.active) throw new CameraError('unknown');
    return this.adapter.startPreview(expectedStream, video);
  }

  stopPreview(video: HTMLVideoElement) {
    this.adapter.stopPreview(video);
    this.disconnect();
    this.status = 'disconnected';
  }

  async captureStill(video: HTMLVideoElement, expectedStream = this.stream) {
    if (!expectedStream || expectedStream !== this.stream || !expectedStream.active || !this.adapter.captureStill) throw new CameraError('unknown');
    return this.adapter.captureStill(expectedStream, video);
  }

  onDevicesChanged(listener: () => void) { return this.adapter.onDevicesChanged(listener); }
}
