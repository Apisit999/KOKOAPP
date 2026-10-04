const { generateKeyPairSync } = require('node:crypto');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const directory = path.resolve('secrets');
mkdirSync(directory, { recursive: true });
const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 3072,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
});
writeFileSync(path.join(directory, 'license-private.pem'), privateKey, { flag: 'wx', mode: 0o600 });
writeFileSync(path.join(directory, 'license-public.pem'), publicKey, { flag: 'wx', mode: 0o644 });
process.stdout.write(`Created signing keys under ${directory}. The private key must remain on the server.\n`);
