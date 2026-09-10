'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');

const { validate } = require('../server/validate');
const { TOOLS } = require('../server/tools');

const tool = (name) => TOOLS.find((t) => t.name === name).inputSchema;

test('accepts a valid video search', () => {
  const errors = validate(tool('search_videos'), {
    keywords: 'ocean',
    content_type: ['footage', 'templates'],
    frame_rates: ['24'],
    has_alpha: false,
    results_per_page: 250,
    extended: ['durationMs'],
  });
  assert.deepEqual(errors, []);
});

test('rejects bad enum, out-of-range, wrong type, and unknown params', () => {
  const errors = validate(tool('search_images'), {
    orientation: 'diagonal',
    results_per_page: 251,
    safe_search: 'yes',
    bogus: 1,
    color: 'red',
  });
  assert.ok(errors.some((e) => e.includes('orientation') && e.includes('one of')));
  assert.ok(errors.some((e) => e.includes('results_per_page') && e.includes('<= 250')));
  assert.ok(errors.some((e) => e.includes('safe_search') && e.includes('expected boolean')));
  assert.ok(errors.some((e) => e.includes('bogus') && e.includes('unknown')));
  assert.ok(errors.some((e) => e.includes('color') && e.includes('hex')));
});

test('enforces required fields and integer types', () => {
  assert.ok(validate(tool('get_stock_item_details'), { media_type: 'videos' }).some((e) => e.includes('stock_item_id') && e.includes('required')));
  assert.ok(validate(tool('get_stock_item_details'), { media_type: 'videos', stock_item_id: 1.5 }).some((e) => e.includes('expected integer')));
  assert.deepEqual(validate(tool('get_stock_item_details'), { media_type: 'audio', stock_item_id: 44020 }), []);
});

test('anyOf items allow mixed id lists; minItems/maxItems enforced', () => {
  const schema = tool('get_stock_items_details_batch');
  assert.deepEqual(validate(schema, { media_type: 'images', stock_item_ids: [1, 'abc', 3] }), []);
  assert.ok(validate(schema, { media_type: 'images', stock_item_ids: [] }).some((e) => e.includes('at least 1')));
  assert.ok(validate(schema, { media_type: 'images', stock_item_ids: [true] }).some((e) => e.includes('does not match')));
});

test('dispute requires a youtube.com/watch URL and a valid email', () => {
  const schema = tool('file_youtube_audio_dispute');
  const base = { disputer_name: 'K', disputer_email: 'k@example.com', claimant_name: 'Storyblocks', stock_item_id: 1 };
  assert.deepEqual(validate(schema, { ...base, disputed_url: 'https://www.youtube.com/watch?v=abc', is_test: 1 }), []);
  assert.ok(validate(schema, { ...base, disputed_url: 'https://youtu.be/abc' }).some((e) => e.includes('youtube.com/watch')));
  assert.ok(validate(schema, { ...base, disputed_url: 'https://www.youtube.com/watch?v=abc', disputer_email: 'nope' }).some((e) => e.includes('email')));
  assert.ok(validate(schema, { ...base, disputed_url: 'https://www.youtube.com/watch?v=abc', is_test: 2 }).some((e) => e.includes('is_test')));
});

test('applies defaults and constrains raw request paths', () => {
  const schema = tool('storyblocks_raw_request');
  const args = { path: '/api/v2/videos/collections' };
  assert.deepEqual(validate(schema, args), []);
  assert.equal(args.method, 'GET');
  assert.ok(validate(schema, { path: 'https://evil.example/x' }).length > 0);
  assert.ok(validate(schema, { path: '/api/v1/other' }).length > 0);
  assert.ok(validate(schema, { path: '/api/v2/videos/search?x=1' }).length > 0);
});

test('every tool schema is a closed object', () => {
  for (const t of TOOLS) {
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.equal(t.inputSchema.additionalProperties, false, t.name);
    assert.ok(t.description.length > 20, t.name);
    assert.ok(t.annotations && typeof t.annotations.readOnlyHint === 'boolean', t.name);
  }
});
