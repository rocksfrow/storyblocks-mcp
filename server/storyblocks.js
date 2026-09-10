'use strict';

/*
 * Signed HTTP client for https://api.storyblocks.com (API v2).
 * Uses only Node's built-in fetch (Node 18+).
 */

const { buildAuthParams } = require('./auth');

class StoryblocksApiError extends Error {
  /**
   * @param {string} message
   * @param {number} status
   * @param {string} statusText
   * @param {string} path
   * @param {unknown} body
   */
  constructor(message, status, statusText, path, body) {
    super(message);
    this.name = 'StoryblocksApiError';
    this.status = status;
    this.statusText = statusText;
    this.path = path;
    this.body = body;
  }
}

/** Arrays become comma-separated lists; booleans become "true"/"false"; null/undefined are dropped. */
function serializeQueryValue(value) {
  if (value === undefined || value === null) return undefined;
  if (Array.isArray(value)) {
    const parts = value.map((v) => String(v).trim()).filter((v) => v.length > 0);
    return parts.length ? parts.join(',') : undefined;
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    return text;
  }
}

class StoryblocksClient {
  /** @param {ReturnType<import('./config').loadConfig>} config */
  constructor(config) {
    this.config = config;
  }

  get defaults() {
    return { userId: this.config.defaultUserId, projectId: this.config.defaultProjectId };
  }

  /** Build a fully signed URL. Auth params are set last so callers cannot override them. */
  buildUrl(path, query = {}) {
    if (!path.startsWith('/')) path = `/${path}`;
    const url = new URL(`${this.config.baseUrl}${path}`);
    for (const [key, raw] of Object.entries(query)) {
      const value = serializeQueryValue(raw);
      if (value !== undefined) url.searchParams.set(key, value);
    }
    const auth = buildAuthParams(url.pathname, this.config.publicKey, this.config.privateKey, this.config.expiresSeconds);
    url.searchParams.set('APIKEY', auth.APIKEY);
    url.searchParams.set('EXPIRES', auth.EXPIRES);
    url.searchParams.set('HMAC', auth.HMAC);
    return url;
  }

  /**
   * @param {{ method?: 'GET'|'POST', path: string, query?: object, body?: unknown }} opts
   */
  async request(opts) {
    const method = opts.method || 'GET';
    const url = this.buildUrl(opts.path, opts.query);

    const headers = { Accept: 'application/json' };
    let body;
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
    let response;
    try {
      response = await fetch(url, { method, headers, body, signal: controller.signal });
    } catch (err) {
      const reason = err && err.name === 'AbortError' ? `timed out after ${this.config.timeoutMs}ms` : (err && err.message) || String(err);
      // Only the path is reported — never the query string, which carries APIKEY/HMAC.
      throw new Error(`Request to ${method} ${url.pathname} failed: ${reason}`);
    } finally {
      clearTimeout(timer);
    }

    const parsed = await parseBody(response);
    if (!response.ok) {
      const detail =
        parsed && typeof parsed === 'object' && 'errors' in parsed
          ? String(parsed.errors)
          : typeof parsed === 'string' && parsed.length
            ? parsed
            : response.statusText;
      throw new StoryblocksApiError(
        `Storyblocks API ${response.status} on ${method} ${url.pathname}: ${detail}`,
        response.status,
        response.statusText,
        url.pathname,
        parsed,
      );
    }
    return parsed;
  }

  // ---- Endpoint wrappers ----------------------------------------------------

  search(media, query) {
    return this.request({ path: `/api/v2/${media}/search`, query });
  }
  details(media, stockItemId, query = {}) {
    return this.request({ path: `/api/v2/${media}/stock-item/details/${encodeURIComponent(stockItemId)}`, query });
  }
  detailsBatch(media, stockItemIds, query = {}) {
    return this.request({ method: 'POST', path: `/api/v2/${media}/stock-item/details`, query, body: { stockItemIds } });
  }
  download(media, stockItemId, query) {
    return this.request({ path: `/api/v2/${media}/stock-item/download/${encodeURIComponent(stockItemId)}`, query });
  }
  categories(media, query = {}) {
    return this.request({ path: `/api/v2/${media}/stock-item/categories`, query });
  }
  collections(media, query = {}) {
    return this.request({ path: `/api/v2/${media}/collections`, query });
  }
  collectionItems(media, collectionId, query = {}) {
    return this.request({ path: `/api/v2/${media}/collections/${encodeURIComponent(collectionId)}`, query });
  }
  similar(media, stockItemId, query = {}) {
    return this.request({ path: `/api/v2/${media}/stock-item/similar/${encodeURIComponent(stockItemId)}`, query });
  }
  expiringContent(media, query = {}) {
    return this.request({ path: `/api/v2/${media}/stock-item/expiring-content`, query });
  }
  whitelistYouTubeChannel(query) {
    return this.request({ method: 'POST', path: '/api/v2/audio/whitelist/youtube', query });
  }
  fileAudioDispute(query) {
    return this.request({ method: 'POST', path: '/api/v2/audio/dispute', query });
  }
  validClaimants() {
    return this.request({ path: '/api/v2/audio/dispute/valid-claimants' });
  }
}

module.exports = { StoryblocksClient, StoryblocksApiError, serializeQueryValue };
