const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { PrintQueueStore } = require('../src/main/services/print-queue.ts');

const options = { printerName: 'Test_Printer', paper: '4x6', landscape: true, copies: 2 };
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);

test('persists print image and settings; recovers an interrupted spool request', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koko-print-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const queue = new PrintQueueStore(root);
  const job = queue.enqueue(png, options);
  assert.equal(queue.imagePath(job).endsWith(`${job.id}.png`), true);
  assert.deepEqual(job.options, options);
  assert.equal(queue.update(job.id, 'printing').status, 'printing');
  assert.equal(readFileSync(path.join(root, 'print-spool', 'jobs.json'), 'utf8').includes('uploadToken'), false);
  const reopened = new PrintQueueStore(root);
  assert.equal(reopened.get(job.id).status, 'pending');
  assert.equal(reopened.update(job.id, 'submitted').status, 'submitted');
});

test('rejects invalid image payloads and preserves a damaged queue', t => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'koko-print-corrupt-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const queue = new PrintQueueStore(root);
  assert.throws(() => queue.enqueue(new Uint8Array([1, 2, 3]), options), /Invalid print image/);
  const file = path.join(root, 'print-spool', 'jobs.json');
  writeFileSync(file, '{broken');
  assert.throws(() => new PrintQueueStore(root), /existing data was preserved/);
  assert.equal(readFileSync(file, 'utf8'), '{broken');
});
