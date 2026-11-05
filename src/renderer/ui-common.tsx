import { useEffect, useState } from 'react';
import { MIN_FREE_PHOTO_STORAGE_BYTES } from '../shared/contract';
import type { PhotoRecord } from '../shared/contract';
import { BrowserCameraAdapter, CameraManager } from './camera/camera-adapter';
import { SimulatedCameraAdapter } from './camera/simulated-camera-adapter';

// Developer/QA switch: open the app with `?camera=simulated` to run the capture flow without a camera.
export const useSimulatedCamera = new URLSearchParams(window.location.search).get('camera') === 'simulated';
export const cameraManager = new CameraManager(useSimulatedCamera ? new SimulatedCameraAdapter() : new BrowserCameraAdapter());
export function hasLowPhotoStorage(bytes: number | null | undefined) { return typeof bytes === 'number' && bytes < MIN_FREE_PHOTO_STORAGE_BYTES; }
export function formatStorageSpace(bytes: number) { return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`; }

export function PhotoThumb({ photo, className = '' }: { photo: PhotoRecord; className?: string }) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let mounted = true;
    let objectUrl = '';
    window.koko.readPhoto(photo.id).then(result => {
      if (!mounted) return;
      objectUrl = URL.createObjectURL(new Blob([Uint8Array.from(result.jpegBytes)], { type: 'image/jpeg' }));
      setUrl(objectUrl);
    }).catch(() => undefined);
    return () => { mounted = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [photo.id]);
  return url ? <img className={className} src={url} alt="" /> : <span className={`${className} photo-placeholder-mark`}>▧</span>;
}

