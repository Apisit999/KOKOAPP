const { createHash, randomBytes, randomUUID, timingSafeEqual } = require('node:crypto');
const { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PHOTO_BYTES = 20 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_FOLDER_PHOTOS = 4;
const MAX_FOLDER_BYTES = 200 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw Object.assign(new Error('Invalid JPEG signature'), { status: 400 });
  let offset = 2;
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) throw Object.assign(new Error('Invalid JPEG marker'), { status: 400 });
    while (offset < bytes.length && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.length) break;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) throw Object.assign(new Error('Truncated JPEG segment'), { status: 400 });
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) throw Object.assign(new Error('Invalid JPEG segment length'), { status: 400 });
    if (startOfFrame.has(marker)) {
      if (length < 7) throw Object.assign(new Error('Invalid JPEG dimensions'), { status: 400 });
      const height = bytes.readUInt16BE(offset + 3); const width = bytes.readUInt16BE(offset + 5);
      if (!width || !height || width * height > 100_000_000) throw Object.assign(new Error('JPEG dimensions exceed the allowed limit'), { status: 400 });
      return { width, height };
    }
    offset += length;
  }
  throw Object.assign(new Error('JPEG dimensions were not found'), { status: 400 });
}

class PhotoCloudStore {
  constructor({ db, root, retentionDays = 90, now = Date.now }) {
    if (!db || typeof db.prepare !== 'function') throw new Error('Photo cloud database is required');
    if (typeof root !== 'string' || !root.trim() || root.includes('\0')) throw new Error('Photo cloud root is required');
    this.db = db;
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('Photo cloud retention must be between 1 and 3650 days');
    this.retentionDays = retentionDays;
    this.now = now;
    this.root = path.resolve(root);
    mkdirSync(this.root, { recursive: true });
    this.assertRoot();
    db.exec(`
      CREATE TABLE IF NOT EXISTS photo_cloud_folders (
        id TEXT PRIMARY KEY, owner_key_hash TEXT NOT NULL, share_key_hash TEXT NOT NULL, label TEXT NOT NULL, created_at TEXT NOT NULL,
        share_revoked_at TEXT, expires_at TEXT, license_id TEXT
      );
      CREATE TABLE IF NOT EXISTS photo_cloud_photos (
        folder_id TEXT NOT NULL REFERENCES photo_cloud_folders(id) ON DELETE CASCADE,
        id TEXT NOT NULL, byte_length INTEGER NOT NULL, sha256 TEXT NOT NULL, saved_at TEXT NOT NULL,
        PRIMARY KEY(folder_id, id)
      );
      CREATE TABLE IF NOT EXISTS photo_cloud_videos (
        folder_id TEXT NOT NULL REFERENCES photo_cloud_folders(id) ON DELETE CASCADE,
        id TEXT NOT NULL, byte_length INTEGER NOT NULL, sha256 TEXT NOT NULL, saved_at TEXT NOT NULL,
        PRIMARY KEY(folder_id, id)
      );
    `);
    const folderColumns = new Set(db.prepare('PRAGMA table_info(photo_cloud_folders)').all().map(column => column.name));
    if (!folderColumns.has('license_id')) db.exec('ALTER TABLE photo_cloud_folders ADD COLUMN license_id TEXT');
    if (!folderColumns.has('share_key_hash')) db.exec('ALTER TABLE photo_cloud_folders ADD COLUMN share_key_hash TEXT');
    if (!folderColumns.has('share_revoked_at')) db.exec('ALTER TABLE photo_cloud_folders ADD COLUMN share_revoked_at TEXT');
    if (!folderColumns.has('expires_at')) {
      db.exec('ALTER TABLE photo_cloud_folders ADD COLUMN expires_at TEXT');
      const legacyFolders = db.prepare('SELECT id,created_at FROM photo_cloud_folders WHERE expires_at IS NULL').all();
      const setExpiry = db.prepare('UPDATE photo_cloud_folders SET expires_at=? WHERE id=?');
      for (const folder of legacyFolders) {
        const createdAt = Date.parse(folder.created_at);
        setExpiry.run(new Date((Number.isFinite(createdAt) ? createdAt : this.now()) + this.retentionDays * 86_400_000).toISOString(), folder.id);
      }
    }
  }

  createFolder(label = 'Photo session', policy = {}) {
    const cleanLabel = typeof label === 'string' ? label.trim().slice(0, 80) : '';
    if (!cleanLabel || /[\u0000-\u001f\u007f]/.test(cleanLabel)) throw new Error('Invalid photo folder name');
    const id = randomUUID();
    const ownerKey = randomBytes(32).toString('base64url');
    const shareKey = randomBytes(32).toString('base64url');
    const createdAt = new Date(this.now()).toISOString();
    const retentionDays = policy.retentionDays ?? this.retentionDays;
    if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) throw new Error('Photo cloud retention must be between 1 and 3650 days');
    const licenseId = policy.licenseId ?? null;
    if (licenseId !== null && (typeof licenseId !== 'string' || !UUID.test(licenseId))) throw new Error('Invalid photo cloud license ID');
    const expiresAt = new Date(this.now() + retentionDays * 86_400_000).toISOString();
    const folderPath = path.join(this.root, id);
    mkdirSync(folderPath, { mode: 0o700 });
    try {
      this.db.prepare('INSERT INTO photo_cloud_folders(id,owner_key_hash,share_key_hash,label,created_at,expires_at,license_id) VALUES(?,?,?,?,?,?,?)')
        .run(id, sha256(ownerKey), sha256(shareKey), cleanLabel, createdAt, expiresAt, licenseId);
    } catch (error) {
      try { require('node:fs').rmdirSync(folderPath); } catch { /* Preserve the database error. */ }
      throw error;
    }
    return { id, ownerKey, shareKey, label: cleanLabel, createdAt, expiresAt };
  }

  purgeExpired() {
    const expired = this.db.prepare('SELECT id FROM photo_cloud_folders WHERE expires_at <= ?').all(new Date(this.now()).toISOString());
    let purged = 0;
    for (const { id } of expired) {
      if (!UUID.test(id)) throw new Error('Expired photo cloud folder has an invalid identifier');
      const folderPath = path.join(this.root, id);
      if (existsSync(folderPath)) {
        this.assertFolder(folderPath);
        for (const name of readdirSync(folderPath)) {
          const filePath = path.join(folderPath, name);
          const info = lstatSync(filePath);
          if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Expired photo cloud folder contains an unsafe entry: ${name}`);
          unlinkSync(filePath);
        }
        rmdirSync(folderPath);
      }
      this.db.prepare('DELETE FROM photo_cloud_photos WHERE folder_id=?').run(id);
      this.db.prepare('DELETE FROM photo_cloud_videos WHERE folder_id=?').run(id);
      this.db.prepare('DELETE FROM photo_cloud_folders WHERE id=?').run(id);
      purged++;
    }
    return purged;
  }

  listPhotos(folderId, ownerKey) {
    const folder = this.authorize(folderId, ownerKey, 'share');
    return { id: folder.id, label: folder.label, createdAt: folder.created_at, expiresAt: folder.expires_at,
      photos: this.db.prepare('SELECT id,byte_length AS byteLength,sha256,saved_at AS savedAt FROM photo_cloud_photos WHERE folder_id=? ORDER BY saved_at DESC,id').all(folder.id),
      videos: this.db.prepare('SELECT id,byte_length AS byteLength,sha256,saved_at AS savedAt FROM photo_cloud_videos WHERE folder_id=? ORDER BY saved_at DESC,id').all(folder.id) };
  }

  savePhoto(folderId, photoId, ownerKey, input) {
    const folder = this.authorize(folderId, ownerKey, 'owner');
    if (typeof photoId !== 'string' || !UUID.test(photoId)) throw Object.assign(new Error('Invalid photo ID'), { status: 400 });
    const bytes = Buffer.from(input);
    if (bytes.length < 4 || bytes.length > MAX_PHOTO_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
      throw Object.assign(new Error('Invalid or oversized JPEG image'), { status: 400 });
    }
    jpegDimensions(bytes);
    const digest = sha256(bytes);
    const existing = this.db.prepare('SELECT id,byte_length AS byteLength,sha256,saved_at AS savedAt FROM photo_cloud_photos WHERE folder_id=? AND id=?').get(folder.id, photoId);
    if (existing) {
      if (existing.sha256 !== digest || existing.byteLength !== bytes.length) throw Object.assign(new Error('Photo ID already exists with different contents'), { status: 409 });
      const folderPath = path.join(this.root, folder.id);
      this.assertFolder(folderPath);
      const existingPath = path.join(folderPath, `${photoId}.jpg`);
      const info = lstatSync(existingPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== existing.byteLength || sha256(readFileSync(existingPath)) !== existing.sha256) {
        throw Object.assign(new Error('Photo file is missing or invalid'), { status: 500 });
      }
      return existing;
    }
    const usage = this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM photo_cloud_photos WHERE folder_id=?) AS count,
      (SELECT COALESCE(SUM(byte_length),0) FROM photo_cloud_photos WHERE folder_id=?) +
      (SELECT COALESCE(SUM(byte_length),0) FROM photo_cloud_videos WHERE folder_id=?) AS bytes`).get(folder.id, folder.id, folder.id);
    if (usage.count >= MAX_FOLDER_PHOTOS || usage.bytes + bytes.length > MAX_FOLDER_BYTES) {
      throw Object.assign(new Error('Private photo folder storage limit reached'), { status: 413 });
    }
    this.assertTenantQuota(folder.license_id, bytes.length);
    const folderPath = path.join(this.root, folder.id);
    this.assertFolder(folderPath);
    const destination = path.join(folderPath, `${photoId}.jpg`);
    const temporary = path.join(folderPath, `.${photoId}.${randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      renameSync(temporary, destination);
      const savedAt = new Date().toISOString();
      this.db.prepare('INSERT INTO photo_cloud_photos(folder_id,id,byte_length,sha256,saved_at) VALUES(?,?,?,?,?)')
        .run(folder.id, photoId, bytes.length, digest, savedAt);
      return { id: photoId, byteLength: bytes.length, sha256: digest, savedAt };
    } catch (error) {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Preserve original error. */ } }
      try { unlinkSync(temporary); } catch { /* The temp file may already have been renamed. */ }
      if (existsSync(destination) && !this.db.prepare('SELECT 1 FROM photo_cloud_photos WHERE folder_id=? AND id=?').get(folder.id, photoId)) {
        try { unlinkSync(destination); } catch { /* Keep the original storage error. */ }
      }
      throw error;
    }
  }

  readPhoto(folderId, photoId, ownerKey) {
    const folder = this.authorize(folderId, ownerKey, 'share');
    if (typeof photoId !== 'string' || !UUID.test(photoId)) throw Object.assign(new Error('Invalid photo ID'), { status: 400 });
    const record = this.db.prepare('SELECT id,byte_length AS byteLength,sha256,saved_at AS savedAt FROM photo_cloud_photos WHERE folder_id=? AND id=?').get(folder.id, photoId);
    if (!record) throw Object.assign(new Error('Photo not found'), { status: 404 });
    const folderPath = path.join(this.root, folder.id);
    this.assertFolder(folderPath);
    const photoPath = path.join(folderPath, `${photoId}.jpg`);
    const info = lstatSync(photoPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== record.byteLength) throw Object.assign(new Error('Photo file is missing or invalid'), { status: 500 });
    const bytes = readFileSync(photoPath);
    if (sha256(bytes) !== record.sha256) throw Object.assign(new Error('Photo integrity check failed'), { status: 500 });
    return { photo: record, bytes };
  }

  saveVideo(folderId, videoId, ownerKey, input) {
    const folder = this.authorize(folderId, ownerKey, 'owner');
    if (typeof videoId !== 'string' || !UUID.test(videoId)) throw Object.assign(new Error('Invalid video ID'), { status: 400 });
    const bytes = Buffer.from(input);
    if (bytes.length < 4 || bytes.length > MAX_VIDEO_BYTES || bytes[0] !== 0x1a || bytes[1] !== 0x45 || bytes[2] !== 0xdf || bytes[3] !== 0xa3) {
      throw Object.assign(new Error('Invalid or oversized WebM video'), { status: 400 });
    }
    const digest = sha256(bytes);
    const existing = this.db.prepare('SELECT id,byte_length AS byteLength,sha256,saved_at AS savedAt FROM photo_cloud_videos WHERE folder_id=? AND id=?').get(folder.id, videoId);
    if (existing) {
      if (existing.sha256 !== digest || existing.byteLength !== bytes.length) throw Object.assign(new Error('Video ID already exists with different contents'), { status: 409 });
      const filePath = path.join(this.root, folder.id, `${videoId}.webm`);
      const info = lstatSync(filePath);
      if (!info.isFile() || info.isSymbolicLink() || info.size !== existing.byteLength || sha256(readFileSync(filePath)) !== existing.sha256) throw Object.assign(new Error('Video file is missing or invalid'), { status: 500 });
      return existing;
    }
    const usage = this.db.prepare(`SELECT
      (SELECT COALESCE(SUM(byte_length),0) FROM photo_cloud_photos WHERE folder_id=?) +
      (SELECT COALESCE(SUM(byte_length),0) FROM photo_cloud_videos WHERE folder_id=?) AS bytes`).get(folder.id, folder.id);
    if (usage.bytes + bytes.length > MAX_FOLDER_BYTES) throw Object.assign(new Error('Private media folder storage limit reached'), { status: 413 });
    this.assertTenantQuota(folder.license_id, bytes.length);
    const folderPath = path.join(this.root, folder.id);
    this.assertFolder(folderPath);
    const destination = path.join(folderPath, `${videoId}.webm`);
    const temporary = path.join(folderPath, `.${videoId}.${randomUUID()}.tmp`);
    let descriptor;
    try {
      descriptor = openSync(temporary, 'wx', 0o600);
      writeFileSync(descriptor, bytes); fsyncSync(descriptor); closeSync(descriptor); descriptor = undefined;
      renameSync(temporary, destination);
      const savedAt = new Date().toISOString();
      this.db.prepare('INSERT INTO photo_cloud_videos(folder_id,id,byte_length,sha256,saved_at) VALUES(?,?,?,?,?)').run(folder.id, videoId, bytes.length, digest, savedAt);
      return { id: videoId, byteLength: bytes.length, sha256: digest, savedAt };
    } catch (error) {
      if (descriptor !== undefined) { try { closeSync(descriptor); } catch { /* Keep the original error. */ } }
      try { unlinkSync(temporary); } catch { /* Preserve the storage failure. */ }
      if (existsSync(destination) && !this.db.prepare('SELECT 1 FROM photo_cloud_videos WHERE folder_id=? AND id=?').get(folder.id, videoId)) { try { unlinkSync(destination); } catch { /* Preserve the storage failure. */ } }
      throw error;
    }
  }

  readVideo(folderId, videoId, ownerKey) {
    const folder = this.authorize(folderId, ownerKey, 'share');
    if (typeof videoId !== 'string' || !UUID.test(videoId)) throw Object.assign(new Error('Invalid video ID'), { status: 400 });
    const record = this.db.prepare('SELECT id,byte_length AS byteLength,sha256,saved_at AS savedAt FROM photo_cloud_videos WHERE folder_id=? AND id=?').get(folder.id, videoId);
    if (!record) throw Object.assign(new Error('Video not found'), { status: 404 });
    const folderPath = path.join(this.root, folder.id); this.assertFolder(folderPath);
    const filePath = path.join(folderPath, `${videoId}.webm`); const info = lstatSync(filePath);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== record.byteLength) throw Object.assign(new Error('Video file is missing or invalid'), { status: 500 });
    const bytes = readFileSync(filePath);
    if (sha256(bytes) !== record.sha256) throw Object.assign(new Error('Video integrity check failed'), { status: 500 });
    return { video: record, bytes };
  }

  revokeShare(folderId, ownerKey) {
    const folder = this.authorize(folderId, ownerKey, 'owner');
    if (!folder.share_revoked_at) this.db.prepare('UPDATE photo_cloud_folders SET share_revoked_at=? WHERE id=?').run(new Date().toISOString(), folder.id);
    return true;
  }

  authorize(folderId, key, access) {
    if (typeof folderId !== 'string' || !UUID.test(folderId) || typeof key !== 'string' || key.length < 32 || key.length > 128) {
      throw Object.assign(new Error('Photo folder not found'), { status: 404 });
    }
    const folder = this.db.prepare('SELECT id,label,created_at,owner_key_hash,share_key_hash,share_revoked_at,expires_at,license_id FROM photo_cloud_folders WHERE id=?').get(folderId);
    if (!folder) throw Object.assign(new Error('Photo folder not found'), { status: 404 });
    if (folder.expires_at && Date.parse(folder.expires_at) <= this.now()) throw Object.assign(new Error('Photo folder not found'), { status: 404 });
    if (access === 'share' && folder.share_revoked_at) throw Object.assign(new Error('Photo folder not found'), { status: 404 });
    const expected = Buffer.from(access === 'owner' ? folder.owner_key_hash : folder.share_key_hash || '', 'hex');
    const actual = Buffer.from(sha256(key), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw Object.assign(new Error('Photo folder not found'), { status: 404 });
    return folder;
  }

  assertTenantQuota(licenseId, incomingBytes) {
    if (!licenseId) return;
    const policy = this.db.prepare(`SELECT p.photo_storage_quota_bytes AS quota FROM licenses l
      JOIN plans p ON p.id=l.plan_id WHERE l.id=?`).get(licenseId);
    if (!policy || !Number.isSafeInteger(policy.quota) || policy.quota < 1) throw Object.assign(new Error('Photo cloud license policy is unavailable'), { status: 503 });
    const nowIso = new Date(this.now()).toISOString();
    const usage = this.db.prepare(`SELECT
      (SELECT COALESCE(SUM(m.byte_length),0) FROM photo_cloud_photos m JOIN photo_cloud_folders f ON f.id=m.folder_id WHERE f.license_id=? AND f.expires_at>?) +
      (SELECT COALESCE(SUM(m.byte_length),0) FROM photo_cloud_videos m JOIN photo_cloud_folders f ON f.id=m.folder_id WHERE f.license_id=? AND f.expires_at>?) AS bytes`).get(licenseId, nowIso, licenseId, nowIso).bytes;
    if (usage + incomingBytes > policy.quota) throw Object.assign(new Error('Tenant photo cloud storage quota reached'), { status: 413, code: 'tenant_storage_quota_reached' });
  }

  assertRoot() {
    const info = lstatSync(this.root);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(this.root) !== this.root) throw new Error('Photo cloud root must be a safe regular directory');
  }

  assertFolder(folderPath) {
    this.assertRoot();
    const info = lstatSync(folderPath);
    if (!info.isDirectory() || info.isSymbolicLink() || realpathSync(folderPath) !== folderPath) throw new Error('Photo cloud folder is unsafe');
  }
}

module.exports = { MAX_PHOTO_BYTES, MAX_VIDEO_BYTES, MAX_FOLDER_PHOTOS, MAX_FOLDER_BYTES, PhotoCloudStore };
