// A virtual ESC/POS receipt printer: reads the bytes the app sends and lists what a real printer would put on paper.
// It understands only the commands the app uses; anything else is reported in `unknown`, so a new command never goes unnoticed.
const QRCode = require('qrcode');

const ECC = { 48: 'L', 49: 'M', 50: 'Q', 51: 'H' };

function emulate(input, options = {}) {
  const bytes = Buffer.from(input);
  const paperDots = options.paperDots ?? 384;
  const items = [];
  const unknown = [];
  const problems = [];
  const state = { align: 'left', bold: false, widthScale: 1, heightScale: 1, qr: { model: 2, size: 3, ecc: 'L', data: null } };
  let line = '';
  const flush = () => {
    if (!line) return;
    items.push({ type: 'text', text: line, align: state.align, bold: state.bold, widthScale: state.widthScale, heightScale: state.heightScale });
    line = '';
  };
  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x0a) { flush(); items.push({ type: 'feed', lines: 1 }); i++; continue; }
    if (b === 0x1b) {
      const c = bytes[i + 1];
      if (c === 0x40) { flush(); Object.assign(state, { align: 'left', bold: false, widthScale: 1, heightScale: 1 }); items.push({ type: 'reset' }); i += 2; continue; }
      if (c === 0x61) { flush(); state.align = ['left', 'center', 'right'][bytes[i + 2] & 3] ?? 'left'; i += 3; continue; }
      if (c === 0x45) { flush(); state.bold = (bytes[i + 2] & 1) === 1; i += 3; continue; }
      unknown.push(`ESC 0x${(c ?? 0).toString(16)}`); i += 2; continue;
    }
    if (b === 0x1d) {
      const c = bytes[i + 1];
      if (c === 0x21) { flush(); const n = bytes[i + 2]; state.widthScale = (n >> 4) + 1; state.heightScale = (n & 15) + 1; i += 3; continue; }
      if (c === 0x56) { // GS V: cut. Form B (0x42) feeds n units first.
        flush(); const mode = bytes[i + 2]; const hasArg = mode === 0x41 || mode === 0x42 || mode === 0x61 || mode === 0x62;
        items.push({ type: 'cut', partial: mode === 0x42 || mode === 0x01 || mode === 0x31 || mode === 0x41 }); i += hasArg ? 4 : 3; continue;
      }
      if (c === 0x76 && bytes[i + 2] === 0x30) { // GS v 0: raster picture
        flush();
        const rowBytes = bytes[i + 4] | (bytes[i + 5] << 8), rows = bytes[i + 6] | (bytes[i + 7] << 8);
        const data = bytes.subarray(i + 8, i + 8 + rowBytes * rows);
        if (data.length !== rowBytes * rows) problems.push('raster data is shorter than its header says');
        const last = items[items.length - 1];
        if (last && last.type === 'raster' && last.width === rowBytes * 8) { last.height += rows; last.data = Buffer.concat([last.data, data]); last.strips++; }
        else items.push({ type: 'raster', width: rowBytes * 8, height: rows, data: Buffer.from(data), strips: 1, align: state.align });
        if (rowBytes * 8 > paperDots) problems.push(`picture is ${rowBytes * 8} dots wide but the paper prints only ${paperDots}`);
        i += 8 + rowBytes * rows; continue;
      }
      if (c === 0x28 && bytes[i + 2] === 0x6b) { // GS ( k: QR code functions
        const len = bytes[i + 3] | (bytes[i + 4] << 8); const cn = bytes[i + 5], fn = bytes[i + 6]; const body = bytes.subarray(i + 7, i + 5 + len);
        if (cn !== 0x31) unknown.push(`GS ( k cn=${cn}`);
        else if (fn === 0x41) state.qr.model = body[0] === 0x32 ? 2 : 1;
        else if (fn === 0x43) state.qr.size = body[0];
        else if (fn === 0x45) state.qr.ecc = ECC[body[0]] ?? 'L';
        else if (fn === 0x50) state.qr.data = Buffer.from(body.subarray(1)).toString('latin1');
        else if (fn === 0x51) {
          flush();
          if (state.qr.data === null) problems.push('QR print command without stored data');
          else {
            const qr = QRCode.create(state.qr.data, { errorCorrectionLevel: state.qr.ecc });
            const modules = qr.modules.size; const dots = modules * state.qr.size;
            items.push({ type: 'qr', data: state.qr.data, ecc: state.qr.ecc, moduleSize: state.qr.size, modules, dots, matrix: Array.from({ length: modules }, (_, y) => Array.from({ length: modules }, (_, x) => qr.modules.get(x, y) ? 1 : 0)), align: state.align });
            if (dots > paperDots) problems.push(`QR code is ${dots} dots wide (version ${qr.version}, module size ${state.qr.size}) but the paper prints only ${paperDots}`);
            if (state.qr.size * 1 < 3) problems.push('QR modules are smaller than 3 dots: hard to scan');
          }
        } else unknown.push(`GS ( k fn=${fn}`);
        i += 5 + len; continue;
      }
      unknown.push(`GS 0x${(c ?? 0).toString(16)}`); i += 2; continue;
    }
    if (b >= 0x20 && b < 0x7f) { line += String.fromCharCode(b); i++; continue; }
    unknown.push(`byte 0x${b.toString(16)}`); i++;
  }
  flush();
  const last = items[items.length - 1];
  if (!last || last.type !== 'cut') problems.push('the receipt does not end with a cut');
  return { items, unknown, problems, paperDots };
}

module.exports = { emulate };
