const assert = require('node:assert/strict');
const { test } = require('node:test');
const { CameraError, CameraManager } = require('../src/renderer/camera/camera-adapter.ts');

class MockAdapter {
  streams = [];
  disconnected = [];
  previews = [];
  stopped = [];
  pendingConnect = null;
  connectCalls = 0;
  async enumerateDevices() { return [{ deviceId: 'camera-1', label: 'Camera 1' }]; }
  async connect(deviceId) {
    this.connectCalls++;
    if (this.pendingConnect) return this.pendingConnect(deviceId);
    const stream = { id: deviceId || `camera-${this.streams.length + 1}`, active: true };
    this.streams.push(stream);
    return stream;
  }
  disconnect(stream) { stream.active = false; this.disconnected.push(stream); }
  async startPreview(stream, video) { this.previews.push({ stream, video }); }
  stopPreview(video) { this.stopped.push(video); }
  getStatus() { return 'searching'; }
  onDevicesChanged() { return () => undefined; }
  async captureStill(stream) { return new Blob([stream.id], { type: 'image/jpeg' }); }
}

test('switching cameras stops the previous stream and uses only the selected stream', async () => {
  const adapter = new MockAdapter();
  const manager = new CameraManager(adapter);
  const first = await manager.connect('camera-1');
  const second = await manager.connect('camera-2');
  assert.equal(adapter.disconnected.includes(first), true);
  assert.equal(manager.getStream(), second);
  await manager.startPreview({}, second);
  assert.equal(adapter.previews.at(-1).stream, second);
  await assert.rejects(manager.startPreview({}, first), CameraError);
  manager.disconnect();
  assert.equal(second.active, false);
  assert.equal(manager.getStream(), null);
});

test('disconnect invalidates an outstanding permission request and closes its late stream', async () => {
  const adapter = new MockAdapter();
  let finishConnect;
  adapter.pendingConnect = () => new Promise(resolve => { finishConnect = resolve; });
  const manager = new CameraManager(adapter);
  const pending = manager.connect('camera-1');
  await Promise.resolve();
  manager.disconnect();
  const lateStream = { id: 'late', active: true };
  finishConnect(lateStream);
  assert.equal(await pending, null);
  assert.equal(lateStream.active, false);
  assert.equal(manager.getStream(), null);
});

test('coalesces duplicate requests for the same camera while permission is pending', async () => {
  const adapter = new MockAdapter();
  let finishConnect;
  adapter.pendingConnect = deviceId => new Promise(resolve => {
    finishConnect = () => resolve({ id: deviceId, active: true });
  });
  const manager = new CameraManager(adapter);
  const first = manager.connect('camera-1');
  const second = manager.connect('camera-1');
  assert.equal(first, second);
  assert.equal(adapter.connectCalls, 1);
  finishConnect();
  assert.equal(await first, manager.getStream());
});

test('exposes camera permission denial as a recoverable state', async () => {
  const adapter = new MockAdapter();
  adapter.connect = async () => { throw new CameraError('permission-denied'); };
  const manager = new CameraManager(adapter);
  await assert.rejects(manager.connect('camera-1'), CameraError);
  assert.equal(manager.getStatus(), 'permission-denied');
});

test('preview and still capture reject streams that are no longer active', async () => {
  const adapter = new MockAdapter();
  const manager = new CameraManager(adapter);
  const stream = await manager.connect('camera-1');
  stream.active = false;
  await assert.rejects(manager.startPreview({}, stream), CameraError);
  await assert.rejects(manager.captureStill({}, stream), CameraError);
});
