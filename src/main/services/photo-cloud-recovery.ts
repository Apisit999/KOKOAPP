import type { CaptureSessionRecord } from '../../shared/contract';

type PhotoCloudRecoveryClient = {
  getShareUrl(sessionId: string): string | null;
  getUploadedPhotoIds(sessionId: string): string[];
  getUploadedVideoIds?(sessionId: string): string[];
  createForSession(sessionId: string, label: string): Promise<string>;
  uploadForSession(sessionId: string, photoId: string, bytes: Uint8Array): Promise<boolean>;
  uploadVideoForSession?(sessionId: string, videoId: string, bytes: Uint8Array): Promise<boolean>;
};

/** Retries local photos on sessions that were captured while the cloud was unavailable. */
export async function retryPendingPhotoCloudUploads(
  sessions: CaptureSessionRecord[],
  client: PhotoCloudRecoveryClient,
  readPhoto: (photoId: string) => Uint8Array,
  labelForSession: (session: CaptureSessionRecord) => string,
  onFailure: (sessionId: string, mediaId: string | null, error: unknown) => void,
  readVideo?: (videoId: string) => Uint8Array
) {
  let uploadedCount = 0;
  let uploadedVideoCount = 0;
  let failedCount = 0;
  for (const session of sessions) {
    const photoIds = [...session.photoIds, ...(session.compositionPhotoId ? [session.compositionPhotoId] : [])];
    const videoIds = session.videoIds ?? [];
    if (!photoIds.length && !videoIds.length) continue;
    try {
      if (!client.getShareUrl(session.id)) await client.createForSession(session.id, labelForSession(session));
    } catch (error) {
      failedCount += photoIds.length + videoIds.length;
      onFailure(session.id, null, error);
      continue;
    }
    const uploaded = new Set(client.getUploadedPhotoIds(session.id));
    for (const photoId of photoIds) {
      if (uploaded.has(photoId)) continue;
      try {
        const bytes = readPhoto(photoId);
        if (await client.uploadForSession(session.id, photoId, bytes)) uploadedCount++;
        else failedCount++;
      } catch (error) {
        failedCount++;
        onFailure(session.id, photoId, error);
      }
    }
    const uploadedVideos = new Set(client.getUploadedVideoIds?.(session.id) ?? []);
    for (const videoId of videoIds) {
      if (uploadedVideos.has(videoId)) continue;
      try {
        if (!client.uploadVideoForSession) throw new Error('Video cloud upload is not available');
        if (!readVideo) throw new Error('Local video reader is not available');
        const bytes = readVideo(videoId);
        if (await client.uploadVideoForSession(session.id, videoId, bytes)) uploadedVideoCount++;
        else failedCount++;
      } catch (error) {
        failedCount++;
        onFailure(session.id, videoId, error);
      }
    }
  }
  return { uploadedCount, ...(uploadedVideoCount ? { uploadedVideoCount } : {}), failedCount };
}
