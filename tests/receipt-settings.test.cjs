const assert = require('node:assert/strict');
const { test } = require('node:test');
const { normalizeReceiptSettings, normalizeReceiptPrinter } = require('../src/shared/receipt-settings.ts');

test('receipt settings: nothing valid means no printer, 58 mm and no auto-print', () => {
  assert.deepEqual(normalizeReceiptSettings(undefined), { paper: 58, autoPrint: false, printer: null });
  assert.deepEqual(normalizeReceiptSettings({ paper: 99, autoPrint: true, printer: { kind: 'usb' } }), { paper: 58, autoPrint: false, printer: null });
});

test('receipt settings: each printer kind keeps only valid fields and drops default ports and baud rates', () => {
  assert.deepEqual(normalizeReceiptPrinter({ kind: 'network', host: '192.168.1.50', port: 9100 }), { kind: 'network', host: '192.168.1.50' });
  assert.deepEqual(normalizeReceiptPrinter({ kind: 'network', host: 'printer.local', port: 9101 }), { kind: 'network', host: 'printer.local', port: 9101 });
  assert.equal(normalizeReceiptPrinter({ kind: 'network', host: 'a b; rm' }), null);
  assert.deepEqual(normalizeReceiptPrinter({ kind: 'windows', name: 'POS-80' }), { kind: 'windows', name: 'POS-80' });
  assert.equal(normalizeReceiptPrinter({ kind: 'windows', name: 'x\ny' }), null);
  assert.deepEqual(normalizeReceiptPrinter({ kind: 'serial', port: 'COM5', baud: 115200 }), { kind: 'serial', port: 'COM5', baud: 115200 });
  assert.deepEqual(normalizeReceiptPrinter({ kind: 'serial', port: 'COM5', baud: 12345 }), { kind: 'serial', port: 'COM5' });
  assert.equal(normalizeReceiptPrinter({ kind: 'serial', port: 'COM1; calc' }), null);
});

test('receipt settings: auto-print needs a printer', () => {
  assert.equal(normalizeReceiptSettings({ autoPrint: true, printer: { kind: 'windows', name: 'POS' } }).autoPrint, true);
  assert.equal(normalizeReceiptSettings({ autoPrint: true }).autoPrint, false);
});
