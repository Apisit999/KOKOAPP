import { defineConfig } from 'vite';

const publicLicenseConfig = [
  'KOKO_LICENSE_API_BASE_URL',
  'KOKO_LICENSE_TRUSTED_KEYS_JSON',
  'KOKO_LICENSE_PRODUCT_ID',
  'KOKO_PHOTO_PUBLIC_BASE_URL',
  'KOKO_BUILD_CHANNEL',
];

const isStaging = process.env.KOKO_BUILD_CHANNEL === 'staging';
if (isStaging) {
  const expectedOrigin = 'https://studio-staging.kokomemory.com';
  const apiOrigin = process.env.KOKO_LICENSE_API_BASE_URL;
  if (apiOrigin !== expectedOrigin) throw new Error('Staging Desktop builds must use the approved staging API origin');
  if ((process.env.KOKO_LICENSE_PRODUCT_ID ?? 'koko-photobooth') !== 'koko-photobooth') {
    throw new Error('Staging Desktop builds must use product koko-photobooth');
  }
  const configuredPhotoOrigin = process.env.KOKO_PHOTO_PUBLIC_BASE_URL;
  if (configuredPhotoOrigin && configuredPhotoOrigin !== expectedOrigin) {
    throw new Error('Staging photo API must use the staging origin');
  }
  let keys;
  try { keys = JSON.parse(process.env.KOKO_LICENSE_TRUSTED_KEYS_JSON ?? '{}'); }
  catch { throw new Error('Staging trusted public keys must be valid JSON'); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)
    || !Object.values(keys).some(value => typeof value === 'string' && value.includes('BEGIN PUBLIC KEY'))) {
    throw new Error('A staging trusted public key is required to package Desktop');
  }
}

const define = Object.fromEntries(
  publicLicenseConfig.map(name => [
    `process.env.${name}`,
    JSON.stringify(process.env[name] ?? ''),
  ]),
);

export default defineConfig({
  define,
  build: { rollupOptions: { external: ['electron'], output: { entryFileNames: 'main.cjs' } } },
});
