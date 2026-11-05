const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildProblemReport, SUPPORT_EMAIL } = require('../src/shared/problem-report.ts');

const base = { description: 'กล้องไม่ติด', version: '0.1.29', platform: 'win32', arch: 'x64', osRelease: '10.0.26300', electron: '40.0.0', licenseState: 'active' };

test('report contains the description and app/system facts', () => {
  const { body, subject } = buildProblemReport(base);
  assert.match(body, /กล้องไม่ติด/);
  assert.match(body, /App: 0\.1\.29/);
  assert.match(body, /win32 x64 10\.0\.26300/);
  assert.match(body, /License: active/);
  assert.match(subject, /0\.1\.29/);
});

test('mailto goes to support and encodes the body', () => {
  const { mailto } = buildProblemReport({ ...base, description: 'a&b=c\nline2' });
  assert.ok(mailto.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`));
  assert.ok(!mailto.includes('a&b=c'));
  assert.match(mailto, /a%26b%3Dc%0Aline2/);
});

test('long descriptions are cut and an empty one is labelled', () => {
  const long = buildProblemReport({ ...base, description: 'x'.repeat(5000) });
  assert.ok(long.body.split('\n')[0].length === 1000);
  assert.match(buildProblemReport({ ...base, description: '   ' }).body, /\(no description\)/);
});
