/** Update information shown in the renderer. The download URL never leaves Electron Main. */
export type UpdateRelease = { version: string; notes: string[]; publishedAt: string | null; sha256: string; fileSize: number };
export type UpdateStatus = {
  state: 'current' | 'available' | 'unknown';
  currentVersion: string;
  checkedAt: string | null;
  mandatory: boolean;
  latest: UpdateRelease | null;
};
