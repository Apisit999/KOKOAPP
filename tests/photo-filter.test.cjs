const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PHOTO_FILTERS, filterCss, isPhotoFilter } = require('../src/shared/photo-filter.ts');

test('known filters give a CSS filter and anything else means none', () => {
  assert.equal(filterCss('bw').startsWith('grayscale'), true);
  assert.equal(filterCss(undefined), 'none'); assert.equal(filterCss('nope'), 'none');
  assert.equal(isPhotoFilter('sepia'), true); assert.equal(isPhotoFilter('x'), false); assert.equal(isPhotoFilter(null), false);
  assert.equal(new Set(PHOTO_FILTERS.map(item => item.id)).size, PHOTO_FILTERS.length);
});
