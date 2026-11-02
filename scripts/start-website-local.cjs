// Starts the Desktop app against the local website stack (http://127.0.0.1:3040).
// Reads PUBLIC configuration only from .env.website-local; the website must be running (npm run studio:dev there).
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const file = path.join(__dirname, '..', process.argv[2] || '.env.website-local');
if (!fs.existsSync(file)) { console.error('Missing .env.website-local (see .env.example for the variable names).'); process.exit(1); }
const config = {};
for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
  const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (match) config[match[1]] = match[2].replace(/^'(.*)'$/, '$1');
}
if (/PRIVATE KEY/.test(JSON.stringify(config))) { console.error('Refusing to start: a private key must never be in the Desktop configuration.'); process.exit(1); }
const bin = path.join(__dirname, '..', 'node_modules', '@electron-forge', 'cli', 'dist', 'electron-forge.js');
const child = spawn(process.execPath, [bin, 'start'], { stdio: 'inherit', env: { ...process.env, ...config } });
child.on('exit', code => { process.exitCode = code ?? 1; });
