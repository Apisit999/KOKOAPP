const assert = require('node:assert/strict');
const { test } = require('node:test');
const { sendToWindowsPrinter, sendToSerialPrinter, listWindowsPrinters, listSerialPorts, sendReceipt } = require('../src/main/services/receipt-printers.ts');

const bytes = new Uint8Array([0x1b, 0x40, 0x41, 0x0a, 0x1d, 0x56, 0x42, 3]);

test('windows printer: name goes in an env var, bytes go through stdin as base64, the script text never contains the name', async () => {
  let call;
  await sendToWindowsPrinter('EPSON TM-T82X "quote"; Remove-Item *', bytes, async (file, args, options) => { call = { file, args, options }; return ''; });
  assert.equal(call.file, 'powershell.exe');
  assert.equal(call.options.env.KOKO_RECEIPT_PRINTER, 'EPSON TM-T82X "quote"; Remove-Item *');
  assert.deepEqual([...Buffer.from(call.options.input, 'base64')], [...bytes]);
  const script = Buffer.from(call.args[call.args.indexOf('-EncodedCommand') + 1], 'base64').toString('utf16le');
  assert.ok(script.includes('RAW') && script.includes('WritePrinter'));
  assert.ok(!script.includes('Remove-Item'), 'the printer name is data, not code');
});

test('windows printer: empty or control-character names are refused', async () => {
  const exec = async () => { throw new Error('must not run'); };
  await assert.rejects(sendToWindowsPrinter('', bytes, exec), /Invalid printer name/);
  await assert.rejects(sendToWindowsPrinter('a\nb', bytes, exec), /Invalid printer name/);
});

test('serial printer: only COMn ports and known baud rates; sets the port up, then writes the bytes', async () => {
  const exec = async () => '';
  const write = async () => { throw new Error('must not run'); };
  await assert.rejects(sendToSerialPrinter('C:\\evil', bytes, {}, exec, write), /Invalid COM port/);
  await assert.rejects(sendToSerialPrinter('COM3', bytes, { baud: 1 }, exec, write), /baud/);
  const seen = [];
  await sendToSerialPrinter('COM7', bytes, { baud: 115200 }, async (file, args) => { seen.push([file, ...args]); return ''; }, async (path, data) => { seen.push([path, data.length]); });
  assert.deepEqual(seen[0], ['mode.com', 'COM7', 'BAUD=115200', 'PARITY=n', 'DATA=8', 'STOP=1']);
  assert.deepEqual(seen[1], ['\\\\.\\COM7', bytes.length]);
});

test('lists: one printer (PowerShell prints a bare string) and many both work; junk is dropped', async () => {
  assert.deepEqual(await listWindowsPrinters(async () => '"POS-80"'), ['POS-80']);
  assert.deepEqual(await listWindowsPrinters(async () => '["A","B"]'), ['A', 'B']);
  assert.deepEqual(await listWindowsPrinters(async () => ''), []);
  assert.deepEqual(await listSerialPorts(async () => '["COM10","COM3","evil"]'), ['COM3', 'COM10']);
});

test('sendReceipt: unknown printer types are rejected', async () => {
  await assert.rejects(sendReceipt({ kind: 'carrier-pigeon' }, bytes), /Unknown receipt printer type/);
});

test('windows printer (real PowerShell): the raw-print script compiles and fails cleanly for a printer that does not exist', { skip: process.platform !== 'win32' }, async () => {
  await assert.rejects(sendToWindowsPrinter('KOKO-NO-SUCH-PRINTER-9f3', bytes), /Could not open printer/);
});
