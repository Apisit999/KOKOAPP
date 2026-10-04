const http = require('node:http');
const { createHash, randomBytes, randomUUID, sign, verify, createPublicKey } = require('node:crypto');
const { mkdirSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { PhotoCloudStore, MAX_PHOTO_BYTES, MAX_VIDEO_BYTES } = require('./photo-cloud-store.cjs');

const PRODUCT_ID = 'koko-photobooth';
const FEATURES = ['capture', 'printing', 'templates'];
const DAY = 86_400_000;

function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function base64url(value) { return Buffer.from(value).toString('base64url'); }
function decodeBase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Malformed base64url');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.toString('base64url') !== value) throw new Error('Non-canonical base64url');
  return bytes;
}
function bearer(req) { const value = req.headers.authorization || ''; return value.startsWith('Bearer ') ? value.slice(7) : ''; }
function safeEqual(left, right) {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && require('node:crypto').timingSafeEqual(a, b);
}
function makeKey(prefix = 'KOKO') { return `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(4).toString('hex').toUpperCase()}-${randomBytes(8).toString('hex').toUpperCase()}`; }

const SCHEMA = `
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT UNIQUE, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 1, name TEXT NOT NULL, billing_period TEXT NOT NULL CHECK(billing_period IN ('month','year','lifetime')),
  amount_minor INTEGER NOT NULL CHECK(amount_minor >= 0), currency TEXT NOT NULL,
  device_limit INTEGER NOT NULL CHECK(device_limit > 0), features_json TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS licenses (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), product_id TEXT NOT NULL,
  plan_id TEXT NOT NULL REFERENCES plans(id), key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','revoked','expired')), starts_at TEXT NOT NULL,
  expires_at TEXT, max_devices INTEGER NOT NULL CHECK(max_devices > 0), development INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS activations (
  id TEXT PRIMARY KEY, license_id TEXT NOT NULL REFERENCES licenses(id), device_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('active','deactivated')), activated_at TEXT NOT NULL,
  deactivated_at TEXT, last_seen_at TEXT NOT NULL, UNIQUE(license_id, device_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, license_id TEXT,
  device_id TEXT, request_id TEXT, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT NOT NULL, action TEXT NOT NULL, response_json TEXT NOT NULL, created_at TEXT NOT NULL,
  PRIMARY KEY(key, action)
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id), license_id TEXT REFERENCES licenses(id),
  provider TEXT NOT NULL, provider_payment_id TEXT, provider_event_id TEXT UNIQUE,
  amount_minor INTEGER NOT NULL, currency TEXT NOT NULL, status TEXT NOT NULL,
  created_at TEXT NOT NULL, verified_at TEXT
);
`;

function createLicenseServer(options = {}) {
  const env = options.env || process.env;
  const production = env.NODE_ENV === 'production' || env.LICENSE_ENV === 'production';
  const environment = production ? 'production' : (env.LICENSE_ENV || 'development');
  const keyId = env.LICENSE_KEY_ID || 'koko-dev-2026';
  const privateKey = options.privateKey || (env.LICENSE_PRIVATE_KEY_FILE ? readFileSync(env.LICENSE_PRIVATE_KEY_FILE, 'utf8') : null);
  const adminToken = options.adminToken ?? env.LICENSE_ADMIN_TOKEN ?? '';
  const productId = env.LICENSE_PRODUCT_ID || PRODUCT_ID;
  const offlineGraceHours = Number(env.LICENSE_OFFLINE_GRACE_HOURS || 72);
  const refreshHours = Number(env.LICENSE_REFRESH_HOURS || 24);
  const offlineGraceMs = offlineGraceHours * 3_600_000;
  const refreshAfterMs = refreshHours * 3_600_000;
  const host = env.LICENSE_HOST || '127.0.0.1';
  const now = options.now || Date.now;
  if (!privateKey) throw new Error('LICENSE_PRIVATE_KEY_FILE is required');
  if (environment === 'production' && adminToken.length < 32) throw new Error('LICENSE_ADMIN_TOKEN must contain at least 32 characters in production');
  if (production && env.LICENSE_HTTPS_TERMINATED !== 'true') throw new Error('Production requires an HTTPS-terminating reverse proxy');
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && env.LICENSE_HTTPS_TERMINATED !== 'true') throw new Error('Non-loopback binding requires an HTTPS-terminating reverse proxy');
  if (!Number.isFinite(offlineGraceHours) || offlineGraceHours < 1 || offlineGraceHours > 720 || !Number.isFinite(refreshHours) || refreshHours < 1 || refreshHours > offlineGraceHours) throw new Error('Offline grace must be 1–720 hours and refresh interval must be within that grace period');
  const dbPath = options.dbPath || env.LICENSE_DB_PATH || path.resolve('data/koko-license.sqlite');
  if (dbPath !== ':memory:') mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = options.db || new DatabaseSync(dbPath);
  db.exec(SCHEMA);
  db.exec('PRAGMA busy_timeout = 5000;');
  const planColumns = new Set(db.prepare('PRAGMA table_info(plans)').all().map(column => column.name));
  if (!planColumns.has('photo_retention_days')) db.exec('ALTER TABLE plans ADD COLUMN photo_retention_days INTEGER NOT NULL DEFAULT 90 CHECK(photo_retention_days BETWEEN 1 AND 3650)');
  if (!planColumns.has('photo_storage_quota_bytes')) db.exec('ALTER TABLE plans ADD COLUMN photo_storage_quota_bytes INTEGER NOT NULL DEFAULT 5368709120 CHECK(photo_storage_quota_bytes BETWEEN 1048576 AND 1099511627776)');
  const photoCloudRoot = options.photoCloudRoot || env.KOKO_PHOTO_CLOUD_PATH || path.join(path.dirname(path.resolve(dbPath)), 'photo-cloud');
  const photoCloudRetentionDays = Number(env.KOKO_PHOTO_CLOUD_RETENTION_DAYS || 90);
  if (!Number.isInteger(photoCloudRetentionDays) || photoCloudRetentionDays < 1 || photoCloudRetentionDays > 3650) throw new Error('KOKO_PHOTO_CLOUD_RETENTION_DAYS must be between 1 and 3650');
  const photoCloud = new PhotoCloudStore({ db, root: photoCloudRoot, retentionDays: photoCloudRetentionDays, now });
  photoCloud.purgeExpired();
  const photoCloudCleanupTimer = setInterval(() => {
    try { photoCloud.purgeExpired(); }
    catch (error) { console.error('Expired photo cloud cleanup failed:', error instanceof Error ? error.message : 'unknown error'); }
  }, 60 * 60 * 1000);
  photoCloudCleanupTimer.unref();
  const defaultRetentionDays = Number(env.KOKO_PHOTO_CLOUD_RETENTION_DAYS || 90);
  const defaultTenantQuotaBytes = Number(env.KOKO_PHOTO_CLOUD_TENANT_QUOTA_BYTES || 5368709120);
  if (!Number.isInteger(defaultRetentionDays) || defaultRetentionDays < 1 || defaultRetentionDays > 3650) throw new Error('KOKO_PHOTO_CLOUD_RETENTION_DAYS must be between 1 and 3650');
  if (!Number.isSafeInteger(defaultTenantQuotaBytes) || defaultTenantQuotaBytes < 1048576 || defaultTenantQuotaBytes > 1099511627776) throw new Error('KOKO_PHOTO_CLOUD_TENANT_QUOTA_BYTES must be between 1 MiB and 1 TiB');
  const defaultPlans = [
    ['monthly', 'Monthly', 'month', 1900, 'USD', 2],
    ['annual', 'Annual', 'year', 19000, 'USD', 2],
    ['lifetime', 'Lifetime', 'lifetime', 39900, 'USD', 2]
  ];
  const insertPlan = db.prepare('INSERT OR IGNORE INTO plans(id,name,billing_period,amount_minor,currency,device_limit,features_json,photo_retention_days,photo_storage_quota_bytes) VALUES(?,?,?,?,?,?,?,?,?)');
  for (const [id, name, period, amount, currency, limit] of defaultPlans) insertPlan.run(id, name, period, amount, currency, limit, JSON.stringify(FEATURES), defaultRetentionDays, defaultTenantQuotaBytes);
  const publicKey = createPublicKey(privateKey);
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const limits = new Map();
  const maxBodyBytes = 16_384;
  const maxHits = Number(env.LICENSE_RATE_LIMIT || 30);
  const windowMs = 60_000;

  function audit(action, { actor = 'desktop', licenseId = null, deviceId = null, requestId = null, details = {} } = {}) {
    db.prepare('INSERT INTO audit_logs(id,actor,action,license_id,device_id,request_id,details_json,created_at) VALUES(?,?,?,?,?,?,?,?)')
      .run(randomUUID(), actor, action, licenseId, deviceId, requestId, JSON.stringify(details), new Date(now()).toISOString());
  }
  function signedEntitlement(license, deviceId) {
    const issued = now();
    const expiresAt = license.expires_at;
    const claims = {
      schemaVersion: 1, keyId, licenseId: license.id, deviceId, productId: license.product_id,
      issuedAt: new Date(issued).toISOString(), startsAt: license.starts_at, expiresAt,
      refreshAfter: new Date(issued + refreshAfterMs).toISOString(),
      offlineUntil: new Date(Math.min(issued + offlineGraceMs, expiresAt ? Date.parse(expiresAt) : Number.MAX_SAFE_INTEGER)).toISOString(),
      features: JSON.parse(license.features_json)
    };
    const head = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: keyId }));
    const body = base64url(JSON.stringify(claims));
    const input = `${head}.${body}`;
    return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
  }
  function verifyEntitlement(token, deviceId, requestedProduct) {
    if (typeof token !== 'string' || token.length > 16_384) return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    try {
      const header = JSON.parse(decodeBase64url(parts[0]).toString('utf8'));
      const claims = JSON.parse(decodeBase64url(parts[1]).toString('utf8'));
      if (header.alg !== 'RS256' || header.kid !== keyId || claims.keyId !== keyId || claims.schemaVersion !== 1) return null;
      if (!verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'), publicKey, decodeBase64url(parts[2]))) return null;
      if (claims.deviceId !== deviceId || claims.productId !== requestedProduct || claims.productId !== productId) return null;
      return claims;
    } catch { return null; }
  }
  function respond(res, status, payload) {
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(body);
  }
  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []; let length = 0;
      req.on('data', chunk => { length += chunk.length; if (length > maxBodyBytes) { reject(Object.assign(new Error('Request too large'), { status: 413 })); req.destroy(); } else chunks.push(chunk); });
      req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); } });
      req.on('error', reject);
    });
  }
  function readBinaryBody(req, limit = MAX_PHOTO_BYTES) {
    return new Promise((resolve, reject) => {
      const chunks = []; let length = 0; let tooLarge = false;
      req.on('data', chunk => {
        length += chunk.length;
        if (length > limit) { tooLarge = true; chunks.length = 0; }
        else if (!tooLarge) chunks.push(chunk);
      });
      req.on('end', () => tooLarge
        ? reject(Object.assign(new Error('Request too large'), { status: 413 }))
        : resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
  }
  function requireActiveDesktopLicense(body) {
    if (!body || typeof body.deviceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.deviceId) || body.productId !== productId) {
      throw Object.assign(new Error('invalid_request'), { status: 400 });
    }
    const claims = verifyEntitlement(body.entitlement, body.deviceId, body.productId);
    if (!claims) throw Object.assign(new Error('invalid_entitlement'), { status: 401 });
    const license = db.prepare('SELECT status,expires_at FROM licenses WHERE id=? AND product_id=?').get(claims.licenseId, productId);
    if (!license || license.status === 'revoked') throw Object.assign(new Error('revoked'), { status: 403 });
    if (license.status !== 'active' || (license.expires_at && now() >= Date.parse(license.expires_at))) throw Object.assign(new Error('expired'), { status: 403 });
    const activation = db.prepare("SELECT id FROM activations WHERE license_id=? AND device_id=? AND status='active'").get(claims.licenseId, body.deviceId);
    if (!activation) throw Object.assign(new Error('device_not_activated'), { status: 403 });
    return { claims, license };
  }
  function respondBinary(res, bytes, mediaId, contentType, extension) {
    res.writeHead(200, {
      'content-type': contentType, 'content-length': bytes.length, 'cache-control': 'private, no-store',
      'content-disposition': `attachment; filename="${mediaId}.${extension}"`, 'x-content-type-options': 'nosniff'
    });
    res.end(bytes);
  }
  function rateLimit(req) {
    if (limits.size > 10_000) {
      const cutoff = now() - windowMs;
      for (const [key, value] of limits) if (value.started < cutoff) limits.delete(key);
    }
    const key = `${req.socket.remoteAddress || 'unknown'}:${req.url.split('?')[0]}`;
    const current = limits.get(key); const time = now();
    if (!current || time - current.started >= windowMs) { limits.set(key, { started: time, count: 1 }); return false; }
    current.count += 1; return current.count > maxHits;
  }
  function requireAdmin(req) { return adminToken.length >= 32 && safeEqual(bearer(req), adminToken); }
  function transact(work) { db.exec('BEGIN IMMEDIATE'); try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; } }
  function issueLicense({ planId, email = null, durationDays = null, development = true }) {
    const plan = db.prepare('SELECT * FROM plans WHERE id = ? AND active = 1').get(planId);
    if (!plan) throw Object.assign(new Error('Unknown plan'), { status: 400 });
    const at = now(); const startsAt = new Date(at).toISOString();
    const daysByPlan = plan.billing_period === 'month' ? 30 : plan.billing_period === 'year' ? 365 : null;
    const days = durationDays == null ? daysByPlan : Number(durationDays);
    if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw Object.assign(new Error('Invalid duration'), { status: 400 });
    const expiresAt = days === null ? null : new Date(at + days * DAY).toISOString();
    const userId = email ? (db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim().toLowerCase())?.id || randomUUID()) : null;
    if (email && !db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).trim().toLowerCase())) db.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,?)').run(userId, String(email).trim().toLowerCase(), startsAt);
    const licenseId = randomUUID(); const licenseKey = makeKey(development ? 'KOKO-DEV' : 'KOKO');
    db.prepare('INSERT INTO licenses(id,user_id,product_id,plan_id,key_hash,key_prefix,status,starts_at,expires_at,max_devices,development,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(licenseId, userId, productId, planId, hash(licenseKey), licenseKey.slice(0, 16), 'active', startsAt, expiresAt, plan.device_limit, development ? 1 : 0, startsAt);
    audit('license.issued', { actor: development ? 'development-admin' : 'admin', licenseId, details: { planId, development: Boolean(development) } });
    return { licenseId, licenseKey, planId, startsAt, expiresAt, maxDevices: plan.device_limit, development: Boolean(development) };
  }

  const server = http.createServer(async (req, res) => {
    const requestId = randomUUID();
    try {
      if (rateLimit(req)) return respond(res, 429, { code: 'rate_limited', requestId });
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') return respond(res, 200, { ok: true });
      const shareAssets = {
        '/share': ['photo-share.html', 'text/html; charset=utf-8'],
        '/photo-share.js': ['photo-share.js', 'text/javascript; charset=utf-8'],
        '/photo-share.css': ['photo-share.css', 'text/css; charset=utf-8']
      };
      if (req.method === 'GET' && shareAssets[url.pathname]) {
        const [fileName, contentType] = shareAssets[url.pathname];
        const bytes = readFileSync(path.join(__dirname, fileName));
        res.writeHead(200, { 'content-type': contentType, 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        return res.end(bytes);
      }
      if (req.method === 'GET' && url.pathname === '/v1/desktop/plans') {
        const plans = db.prepare('SELECT id,version,name,billing_period,amount_minor,currency,device_limit,features_json,photo_retention_days,photo_storage_quota_bytes FROM plans WHERE active = 1 ORDER BY amount_minor').all();
        return respond(res, 200, { plans: plans.map(p => ({ id: p.id, version: p.version, name: p.name, billingPeriod: p.billing_period, amountMinor: p.amount_minor, currency: p.currency, deviceLimit: p.device_limit, features: JSON.parse(p.features_json), photoRetentionDays: p.photo_retention_days, photoStorageQuotaBytes: p.photo_storage_quota_bytes })) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/desktop/photo-folders') {
        const body = await readBody(req);
        const { claims } = requireActiveDesktopLicense(body);
        const policy = db.prepare('SELECT photo_retention_days FROM plans JOIN licenses ON licenses.plan_id=plans.id WHERE licenses.id=?').get(claims.licenseId);
        if (!policy) throw Object.assign(new Error('Photo cloud license policy is unavailable'), { status: 503 });
        const folder = photoCloud.createFolder(body.label, { licenseId: claims.licenseId, retentionDays: policy.photo_retention_days });
        return respond(res, 201, folder);
      }
      const shareRevokeMatch = url.pathname.match(/^\/v1\/desktop\/photo-folders\/([0-9a-f-]{36})\/revoke$/i);
      if (req.method === 'POST' && shareRevokeMatch) {
        const ownerKey = bearer(req);
        if (!ownerKey) return respond(res, 404, { code: 'photo_folder_not_found', requestId });
        photoCloud.revokeShare(shareRevokeMatch[1], ownerKey);
        return respond(res, 200, { ok: true });
      }
      const uploadMatch = url.pathname.match(/^\/v1\/desktop\/photo-folders\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})$/i);
      if (req.method === 'PUT' && uploadMatch) {
        if (req.headers['content-type'] !== 'image/jpeg') return respond(res, 415, { code: 'unsupported_media_type', requestId });
        const ownerKey = bearer(req);
        if (!ownerKey) return respond(res, 404, { code: 'photo_folder_not_found', requestId });
        const bytes = await readBinaryBody(req);
        const photo = photoCloud.savePhoto(uploadMatch[1], uploadMatch[2], ownerKey, bytes);
        return respond(res, 201, photo);
      }
      const folderMatch = url.pathname.match(/^\/v1\/public\/photo-folders\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && folderMatch) {
        const photos = photoCloud.listPhotos(folderMatch[1], bearer(req));
        return respond(res, 200, photos);
      }
      const photoMatch = url.pathname.match(/^\/v1\/public\/photo-folders\/([0-9a-f-]{36})\/photos\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && photoMatch) {
        const result = photoCloud.readPhoto(photoMatch[1], photoMatch[2], bearer(req));
        return respondBinary(res, result.bytes, result.photo.id, 'image/jpeg', 'jpg');
      }
      const videoUploadMatch = url.pathname.match(/^\/v1\/desktop\/photo-folders\/([0-9a-f-]{36})\/videos\/([0-9a-f-]{36})$/i);
      if (req.method === 'PUT' && videoUploadMatch) {
        if (req.headers['content-type'] !== 'video/webm') return respond(res, 415, { code: 'unsupported_media_type', requestId });
        const ownerKey = bearer(req);
        if (!ownerKey) return respond(res, 404, { code: 'photo_folder_not_found', requestId });
        const bytes = await readBinaryBody(req, MAX_VIDEO_BYTES);
        const video = photoCloud.saveVideo(videoUploadMatch[1], videoUploadMatch[2], ownerKey, bytes);
        return respond(res, 201, video);
      }
      const videoMatch = url.pathname.match(/^\/v1\/public\/photo-folders\/([0-9a-f-]{36})\/videos\/([0-9a-f-]{36})$/i);
      if (req.method === 'GET' && videoMatch) {
        const result = photoCloud.readVideo(videoMatch[1], videoMatch[2], bearer(req));
        return respondBinary(res, result.bytes, result.video.id, 'video/webm', 'webm');
      }
      if (req.method === 'POST' && url.pathname === '/v1/admin/development/licenses') {
        if (production) return respond(res, 404, { code: 'not_found', requestId });
        if (!requireAdmin(req)) return respond(res, 401, { code: 'unauthorized', requestId });
        const body = await readBody(req);
        const issued = issueLicense({ planId: body.planId, email: body.email, durationDays: body.durationDays, development: true });
        return respond(res, 201, issued);
      }
      const photoPolicyMatch = url.pathname.match(/^\/v1\/admin\/plans\/([A-Za-z0-9_-]{1,80})\/photo-policy$/);
      if (req.method === 'PUT' && photoPolicyMatch) {
        if (!requireAdmin(req)) return respond(res, 401, { code: 'unauthorized', requestId });
        const body = await readBody(req);
        if (!body || typeof body !== 'object' || Array.isArray(body)
          || !Number.isInteger(body.retentionDays) || body.retentionDays < 1 || body.retentionDays > 3650
          || !Number.isSafeInteger(body.storageQuotaBytes) || body.storageQuotaBytes < 1048576 || body.storageQuotaBytes > 1099511627776) {
          return respond(res, 400, { code: 'invalid_photo_policy', requestId });
        }
        const updated = transact(() => {
          const changed = db.prepare('UPDATE plans SET photo_retention_days=?,photo_storage_quota_bytes=?,version=version+1 WHERE id=?')
            .run(body.retentionDays, body.storageQuotaBytes, photoPolicyMatch[1]);
          if (!changed.changes) return false;
          audit('plan.photo_policy_updated', { actor: 'admin', requestId, details: { planId: photoPolicyMatch[1], retentionDays: body.retentionDays, storageQuotaBytes: body.storageQuotaBytes } });
          return true;
        });
        if (!updated) return respond(res, 404, { code: 'plan_not_found', requestId });
        return respond(res, 200, { planId: photoPolicyMatch[1], retentionDays: body.retentionDays, storageQuotaBytes: body.storageQuotaBytes });
      }
      const revokeMatch = url.pathname.match(/^\/v1\/admin\/licenses\/([0-9a-f-]+)\/revoke$/i);
      if (req.method === 'POST' && revokeMatch) {
        if (!requireAdmin(req)) return respond(res, 401, { code: 'unauthorized', requestId });
        const body = await readBody(req); const idem = body.idempotencyKey;
        if (typeof idem !== 'string' || idem.length < 8 || idem.length > 160) return respond(res, 400, { code: 'invalid_request', requestId });
        const action = `revoke:${revokeMatch[1]}`;
        const previous = db.prepare('SELECT response_json FROM idempotency_keys WHERE key=? AND action=?').get(idem, action);
        if (previous) return respond(res, 200, JSON.parse(previous.response_json));
        const result = transact(() => {
          const license = db.prepare('SELECT id,status FROM licenses WHERE id=?').get(revokeMatch[1]);
          if (!license) throw Object.assign(new Error('invalid_license'), { status: 404 });
          db.prepare("UPDATE licenses SET status='revoked', revoked_at=? WHERE id=?").run(new Date(now()).toISOString(), license.id);
          const response = { ok: true, licenseId: license.id, status: 'revoked' };
          db.prepare('INSERT INTO idempotency_keys(key,action,response_json,created_at) VALUES(?,?,?,?)').run(idem, action, JSON.stringify(response), new Date(now()).toISOString());
          audit('license.revoked', { actor: 'admin', licenseId: license.id, requestId }); return response;
        });
        return respond(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/v1/desktop/licenses/activate') {
        const body = await readBody(req);
        if (typeof body.licenseKey !== 'string' || body.licenseKey.length < 8 || body.licenseKey.length > 256 || typeof body.deviceId !== 'string' || !/^[0-9a-f-]{36}$/i.test(body.deviceId) || body.productId !== productId || typeof body.idempotencyKey !== 'string' || body.idempotencyKey.length < 8 || body.idempotencyKey.length > 160) return respond(res, 400, { code: 'invalid_request', requestId });
        const keyHash = hash(body.licenseKey.trim());
        const license = db.prepare('SELECT l.*,p.features_json FROM licenses l JOIN plans p ON p.id=l.plan_id WHERE l.key_hash=? AND l.product_id=?').get(keyHash, body.productId);
        if (!license) { audit('license.activation_denied', { details: { reason: 'invalid_license' }, requestId }); return respond(res, 401, { code: 'invalid_license', requestId }); }
        if (license.status === 'revoked') return respond(res, 403, { code: 'revoked', requestId });
        if (license.status !== 'active' || (license.expires_at && now() >= Date.parse(license.expires_at))) return respond(res, 403, { code: 'expired', requestId });
        const old = db.prepare('SELECT response_json FROM idempotency_keys WHERE key=? AND action=?').get(body.idempotencyKey, `activate:${license.id}:${body.deviceId}`);
        if (old) return respond(res, 200, JSON.parse(old.response_json));
        const activation = db.prepare('SELECT * FROM activations WHERE license_id=? AND device_id=?').get(license.id, body.deviceId);
        const activeCount = db.prepare("SELECT COUNT(*) AS count FROM activations WHERE license_id=? AND status='active'").get(license.id).count;
        if (!activation && activeCount >= license.max_devices) { audit('license.activation_denied', { licenseId: license.id, deviceId: body.deviceId, details: { reason: 'device_limit' }, requestId }); return respond(res, 403, { code: 'device_limit', requestId }); }
        const result = transact(() => {
          const at = new Date(now()).toISOString();
          if (activation) db.prepare("UPDATE activations SET status='active',deactivated_at=NULL,last_seen_at=? WHERE id=?").run(at, activation.id);
          else db.prepare("INSERT INTO activations(id,license_id,device_id,status,activated_at,last_seen_at) VALUES(?,?,?,'active',?,?)").run(randomUUID(), license.id, body.deviceId, at, at);
          const response = { entitlement: signedEntitlement(license, body.deviceId) };
          db.prepare('INSERT INTO idempotency_keys(key,action,response_json,created_at) VALUES(?,?,?,?)').run(body.idempotencyKey, `activate:${license.id}:${body.deviceId}`, JSON.stringify(response), at);
          audit('license.activated', { licenseId: license.id, deviceId: body.deviceId, requestId }); return response;
        });
        return respond(res, 200, result);
      }
      if (req.method === 'POST' && url.pathname === '/v1/desktop/leases/refresh') {
        const body = await readBody(req);
        if (typeof body.deviceId !== 'string' || body.productId !== productId) return respond(res, 400, { code: 'invalid_request', requestId });
        const claims = verifyEntitlement(body.entitlement, body.deviceId, body.productId);
        if (!claims) return respond(res, 401, { code: 'invalid_entitlement', requestId });
        const license = db.prepare('SELECT l.*,p.features_json FROM licenses l JOIN plans p ON p.id=l.plan_id WHERE l.id=?').get(claims.licenseId);
        if (!license) return respond(res, 403, { state: 'revoked', requestId });
        if (license.status === 'revoked') return respond(res, 200, { state: 'revoked', requestId });
        if (license.status !== 'active' || (license.expires_at && now() >= Date.parse(license.expires_at))) return respond(res, 200, { state: 'expired', requestId });
        const activation = db.prepare("SELECT id FROM activations WHERE license_id=? AND device_id=? AND status='active'").get(license.id, body.deviceId);
        if (!activation) return respond(res, 200, { state: 'device_limit', requestId });
        db.prepare('UPDATE activations SET last_seen_at=? WHERE id=?').run(new Date(now()).toISOString(), activation.id);
        return respond(res, 200, { entitlement: signedEntitlement(license, body.deviceId) });
      }
      if (req.method === 'POST' && url.pathname === '/v1/desktop/licenses/deactivate') {
        const body = await readBody(req);
        if (typeof body.deviceId !== 'string' || body.productId !== productId || typeof body.idempotencyKey !== 'string') return respond(res, 400, { code: 'invalid_request', requestId });
        const claims = verifyEntitlement(body.entitlement, body.deviceId, body.productId);
        if (!claims) return respond(res, 401, { code: 'invalid_entitlement', requestId });
        const action = `deactivate:${claims.licenseId}:${body.deviceId}`;
        const prior = db.prepare('SELECT response_json FROM idempotency_keys WHERE key=? AND action=?').get(body.idempotencyKey, action);
        if (prior) return respond(res, 200, JSON.parse(prior.response_json));
        const response = transact(() => {
          db.prepare("UPDATE activations SET status='deactivated',deactivated_at=? WHERE license_id=? AND device_id=? AND status='active'").run(new Date(now()).toISOString(), claims.licenseId, body.deviceId);
          const value = { ok: true };
          db.prepare('INSERT INTO idempotency_keys(key,action,response_json,created_at) VALUES(?,?,?,?)').run(body.idempotencyKey, action, JSON.stringify(value), new Date(now()).toISOString());
          audit('license.deactivated', { licenseId: claims.licenseId, deviceId: body.deviceId, requestId }); return value;
        });
        return respond(res, 200, response);
      }
      return respond(res, 404, { code: 'not_found', requestId });
    } catch (error) {
      const status = Number(error && error.status) || 500;
      return respond(res, status, { code: status < 500 ? (error.message || 'invalid_request') : 'server_error', requestId });
    }
  });
  return { server, db, photoCloud, publicKey: publicPem, issueLicense, close: () => { clearInterval(photoCloudCleanupTimer); server.close(); db.close(); } };
}

module.exports = { createLicenseServer };

if (require.main === module) {
  const service = createLicenseServer();
  const port = Number(process.env.LICENSE_PORT || 8787);
  const host = process.env.LICENSE_HOST || '127.0.0.1';
  service.server.listen(port, host, () => process.stdout.write(`KOKO License Server listening on http://${host}:${port} (${process.env.LICENSE_ENV || 'development'})\n`));
  const stop = () => service.close();
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
