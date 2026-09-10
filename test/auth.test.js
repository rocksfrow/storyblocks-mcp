'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { test } = require('node:test');

const { buildAuthParams, computeHmac } = require('../server/auth');
const { StoryblocksClient, serializeQueryValue } = require('../server/storyblocks');

const privateKey = 'test-private-key-123';
const resource = '/api/v2/videos/search';
const expires = 1700000000;

test('computeHmac matches the openssl example from the Storyblocks docs', () => {
  // Mirrors the Bash example: printf %s "$resource" | openssl dgst -sha256 -hmac "$privateKey$expires"
  const out = execFileSync('openssl', ['dgst', '-sha256', '-hmac', `${privateKey}${expires}`], { input: resource, encoding: 'utf8' });
  const expected = out.trim().replace(/^.*= /, '');
  assert.equal(computeHmac(resource, privateKey, expires), expected);
});

test('buildAuthParams derives EXPIRES from now + ttl and signs with it', () => {
  const params = buildAuthParams(resource, 'pub', privateKey, 300, () => expires * 1000);
  assert.equal(params.APIKEY, 'pub');
  assert.equal(params.EXPIRES, String(expires + 300));
  assert.equal(params.HMAC, computeHmac(resource, privateKey, expires + 300));
});

test('serializeQueryValue handles arrays, booleans, and empties', () => {
  assert.equal(serializeQueryValue(['a', ' b ', '']), 'a,b');
  assert.equal(serializeQueryValue([]), undefined);
  assert.equal(serializeQueryValue(true), 'true');
  assert.equal(serializeQueryValue(false), 'false');
  assert.equal(serializeQueryValue(0), '0');
  assert.equal(serializeQueryValue(null), undefined);
  assert.equal(serializeQueryValue(undefined), undefined);
});

test('client signs the path (including path params) and auth params cannot be overridden', () => {
  const client = new StoryblocksClient({
    publicKey: 'pub',
    privateKey,
    baseUrl: 'https://api.storyblocks.com',
    expiresSeconds: 60,
    timeoutMs: 1000,
  });
  const url = client.buildUrl('/api/v2/videos/stock-item/similar/123', {
    limit: 8,
    extended: ['keywords', 'durationMs'],
    has_alpha: false,
    skipped: undefined,
    APIKEY: 'attacker',
    HMAC: 'attacker',
  });
  assert.equal(url.origin + url.pathname, 'https://api.storyblocks.com/api/v2/videos/stock-item/similar/123');
  assert.equal(url.searchParams.get('limit'), '8');
  assert.equal(url.searchParams.get('extended'), 'keywords,durationMs');
  assert.equal(url.searchParams.get('has_alpha'), 'false');
  assert.equal(url.searchParams.has('skipped'), false);
  assert.equal(url.searchParams.get('APIKEY'), 'pub');
  const signedExpires = url.searchParams.get('EXPIRES');
  assert.equal(url.searchParams.get('HMAC'), computeHmac(url.pathname, privateKey, signedExpires));
});
