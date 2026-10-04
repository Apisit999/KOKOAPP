const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'assets');
fs.mkdirSync(outputDir, { recursive: true });

const source = PNG.sync.read(fs.readFileSync(path.join(outputDir, 'koko-studio.png')));

function resizeIcon(size) {
  const output = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const sx = Math.max(0, Math.min(source.width - 1, (x + 0.5) * source.width / size - 0.5));
    const sy = Math.max(0, Math.min(source.height - 1, (y + 0.5) * source.height / size - 0.5));
    const x0 = Math.floor(sx); const y0 = Math.floor(sy);
    const x1 = Math.min(source.width - 1, x0 + 1); const y1 = Math.min(source.height - 1, y0 + 1);
    const fx = sx - x0; const fy = sy - y0;
    const target = (y * size + x) * 4;
    for (let channel = 0; channel < 4; channel++) {
      const top = source.data[(y0 * source.width + x0) * 4 + channel] * (1 - fx) + source.data[(y0 * source.width + x1) * 4 + channel] * fx;
      const bottom = source.data[(y1 * source.width + x0) * 4 + channel] * (1 - fx) + source.data[(y1 * source.width + x1) * 4 + channel] * fx;
      output.data[target + channel] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }
  return PNG.sync.write(output);
}

const sizes = [16, 24, 32, 48, 64, 128, 256];
const entries = sizes.map(size => ({ size, bytes: resizeIcon(size) }));
const header = Buffer.alloc(6 + entries.length * 16);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(entries.length, 4);
let offset = header.length;
entries.forEach(({ size, bytes }, index) => {
  const position = 6 + index * 16;
  header[position] = size === 256 ? 0 : size;
  header[position + 1] = size === 256 ? 0 : size;
  header[position + 2] = 0; header[position + 3] = 0;
  header.writeUInt16LE(1, position + 4);
  header.writeUInt16LE(32, position + 6);
  header.writeUInt32LE(bytes.length, position + 8);
  header.writeUInt32LE(offset, position + 12);
  offset += bytes.length;
});
const icon = Buffer.concat([header, ...entries.map(entry => entry.bytes)]);
fs.writeFileSync(path.join(outputDir, 'koko-studio.ico'), icon);

const icnsSizes = [
  ['icp4', 16], ['icp5', 32], ['icp6', 64],
  ['ic07', 128], ['ic08', 256], ['ic09', 512]
];
const icnsChunks = icnsSizes.map(([type, size]) => {
  const png = resizeIcon(size);
  const chunk = Buffer.alloc(8 + png.length);
  chunk.write(type, 0, 4, 'ascii');
  chunk.writeUInt32BE(chunk.length, 4);
  png.copy(chunk, 8);
  return chunk;
});
const icnsSize = 8 + icnsChunks.reduce((total, chunk) => total + chunk.length, 0);
const icns = Buffer.alloc(icnsSize);
icns.write('icns', 0, 4, 'ascii');
icns.writeUInt32BE(icnsSize, 4);
let icnsOffset = 8;
for (const chunk of icnsChunks) { chunk.copy(icns, icnsOffset); icnsOffset += chunk.length; }
fs.writeFileSync(path.join(outputDir, 'koko-studio.icns'), icns);
console.log(`Wrote KOKO Studio icon sets (${sizes.join(', ')} px ICO; ${icnsSizes.map(([, size]) => size).join(', ')} px ICNS) to ${outputDir}`);
