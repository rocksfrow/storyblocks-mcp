'use strict';

/*
 * Storyblocks HMAC authentication.
 *
 * Every request carries three query parameters:
 *   APIKEY  - the client's public key
 *   EXPIRES - unix timestamp (seconds); must be in the future, at most 36h ahead
 *   HMAC    - hex(HMAC-SHA256(key = privateKey + EXPIRES, data = resource path))
 *
 * The "resource" is the URL path only (e.g. `/api/v2/videos/search`), with no host
 * and no query string. Path parameters (e.g. a stock item id) are part of the path
 * and therefore part of the signed data.
 */

const { createHmac } = require('crypto');

/**
 * @param {string} resource  URL path, e.g. "/api/v2/videos/search"
 * @param {string} privateKey
 * @param {number|string} expires  unix seconds
 * @returns {string} lowercase hex digest
 */
function computeHmac(resource, privateKey, expires) {
  return createHmac('sha256', `${privateKey}${expires}`).update(resource).digest('hex');
}

/**
 * @param {string} resource
 * @param {string} publicKey
 * @param {string} privateKey
 * @param {number} expiresSeconds  how far in the future EXPIRES should be
 * @param {() => number} [now]  clock in milliseconds (injectable for tests)
 * @returns {{ APIKEY: string, EXPIRES: string, HMAC: string }}
 */
function buildAuthParams(resource, publicKey, privateKey, expiresSeconds, now = () => Date.now()) {
  const expires = Math.floor(now() / 1000) + expiresSeconds;
  return { APIKEY: publicKey, EXPIRES: String(expires), HMAC: computeHmac(resource, privateKey, expires) };
}

module.exports = { computeHmac, buildAuthParams };
