'use strict';

/*
 * Tool definitions (name, description, JSON Schema, annotations) and handlers.
 * Handlers return a JSON-serializable value; errors are converted by index.js.
 */

const S = require('./schemas');
const { StoryblocksApiError } = require('./storyblocks');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const MUTATING = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const NON_IDEMPOTENT = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };

const TOOLS = [
  {
    name: 'search_videos',
    title: 'Search videos',
    description:
      'Search the Storyblocks video library (footage, motion backgrounds, templates). ' +
      'Returns { total_results, results: [{ id, title, type, contentClass, thumbnail_url, preview_urls, duration, durationMs, orientation, ... }] }. ' +
      'Search results are capped at 10,000 items total. Requires user_id and project_id (or env defaults).',
    inputSchema: S.videoSearch,
    annotations: READ_ONLY,
  },
  {
    name: 'search_audio',
    title: 'Search audio',
    description:
      'Search the Storyblocks audio library (music and sound effects). ' +
      'Returns { total_results, results: [{ id, title, type, contentClass, thumbnail_url, waveform_url, preview_url, duration, durationMs, bpm, ... }] }. ' +
      'Search results are capped at 10,000 items total. Requires user_id and project_id (or env defaults).',
    inputSchema: S.audioSearch,
    annotations: READ_ONLY,
  },
  {
    name: 'search_images',
    title: 'Search images',
    description:
      'Search the Storyblocks image library (photos, illustrations, vectors, snapshots). ' +
      'Returns { total_results, results: [{ id, title, type, contentClass, thumbnail_url, preview_url, ... }] }. ' +
      'Search results are capped at 10,000 items total. Requires user_id and project_id (or env defaults).',
    inputSchema: S.imageSearch,
    annotations: READ_ONLY,
  },
  {
    name: 'get_stock_item_details',
    title: 'Get stock item details',
    description:
      'Get full metadata for one stock item: title, description, keywords, categories, download_formats (with sizes/dimensions), ' +
      'asset_id, contributor, release flags, expiration_date, and media-specific fields (bpm/topTags for audio, aspect_ratio for images, orientation/has_alpha for video).',
    inputSchema: {
      type: 'object',
      properties: {
        media_type: S.mediaType,
        stock_item_id: S.stockItemId,
        content_statuses: S.contentStatuses,
        user_id: S.userId,
        project_id: S.projectId,
      },
      required: ['media_type', 'stock_item_id'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'get_stock_items_details_batch',
    title: 'Get stock item details (batch)',
    description:
      'Get detailed metadata for many stock items of one media type in a single call. ' +
      'Returns { total_results, results: { invalid_stock_ids, stock_ids_not_found, stock_items: [...] } }. ' +
      'By default every requested id is returned in one response (all upstream pages are fetched and merged), so ' +
      'invalid_stock_ids and stock_ids_not_found are always complete. Only set page/results_per_page if you deliberately want ' +
      'a single upstream page — note Storyblocks reports the invalid/not-found lists only on the final page.',
    inputSchema: {
      type: 'object',
      properties: {
        media_type: S.mediaType,
        stock_item_ids: {
          type: 'array',
          items: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1 }] },
          minItems: 1,
          maxItems: 500,
          description: 'Stock item ids to look up. Non-numeric values are echoed back under invalid_stock_ids.',
        },
        page: { ...S.page, description: 'Upstream page to fetch. Omit (recommended) to fetch and merge all pages.' },
        results_per_page: {
          type: 'integer',
          minimum: 1,
          description: 'Upstream page size. Omit (recommended) to fetch and merge all pages; Storyblocks defaults to 10 when paginating explicitly.',
        },
        content_statuses: S.contentStatuses,
        user_id: S.userId,
        project_id: S.projectId,
      },
      required: ['media_type', 'stock_item_ids'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'get_download_links',
    title: 'Get download links',
    description:
      'Get full-quality download URLs for a stock item, keyed by format (e.g. video: { MP4: { _1080p, _720p }, MOV: {...} }; ' +
      'audio: { MP3, WAV }; image: { JPG, EPS, PDF, PSD }). This is a LICENSED DOWNLOAD EVENT: it counts against the account\'s download ' +
      'limit, so call it only when the user has chosen an item to use, not while browsing. The URLs are CloudFront-signed and expire about ' +
      '30 minutes after issue — fetch the bytes immediately and never store the URL. (Preview/thumbnail URLs from search are public and safe to keep.)',
    inputSchema: {
      type: 'object',
      properties: {
        media_type: S.mediaType,
        stock_item_id: S.stockItemId,
        user_id: S.userId,
        project_id: S.projectId,
      },
      required: ['media_type', 'stock_item_id'],
      additionalProperties: false,
    },
    annotations: MUTATING,
  },
  {
    name: 'list_categories',
    title: 'List categories',
    description:
      'List browsable categories for a media type. Returns [{ id, name, content_type, category_group? }]. ' +
      'Use the ids with the `categories` search filter together with the matching `content_type`.',
    inputSchema: {
      type: 'object',
      properties: { media_type: S.mediaType, user_id: S.userId, project_id: S.projectId },
      required: ['media_type'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'list_collections',
    title: 'List curated collections',
    description:
      'List hand-curated collections/playlists for a media type. Returns { total_results, page, results_per_page, total_pages, ' +
      'collections: [{ id, name, description?, num_items, date_added, date_updated }] }. Storyblocks returns the whole list (hundreds of ' +
      'entries) in one response, so this tool pages it for you (50 per page by default) and can filter by name with `search`.',
    inputSchema: {
      type: 'object',
      properties: {
        media_type: S.mediaType,
        search: { type: 'string', minLength: 1, description: 'Case-insensitive substring to match against collection name or description.' },
        page: S.page,
        results_per_page: { type: 'integer', minimum: 1, maximum: 500, description: 'Collections per page. Defaults to 50.' },
        include_description: { type: 'boolean', description: 'Include each collection\'s description text. Defaults to false to keep responses small.' },
        user_id: S.userId,
        project_id: S.projectId,
      },
      required: ['media_type'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'get_collection_items',
    title: 'Get collection items',
    description:
      'List the stock items inside a curated collection. Pages contain 100 items; use `page` to fetch more. ' +
      'Returns an array of summary stock items (id, title, thumbnail_url, preview urls, duration, ...).',
    inputSchema: {
      type: 'object',
      properties: {
        media_type: S.mediaType,
        collection_id: { type: 'integer', minimum: 1, description: 'Collection id from list_collections.' },
        page: S.page,
        user_id: S.userId,
        project_id: S.projectId,
      },
      required: ['media_type', 'collection_id'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'find_similar_stock_items',
    title: 'Find similar stock items',
    description:
      'Find stock items similar to a given item ("more like this"). Returns an array of summary stock items. ' +
      'Not every API key is entitled to this endpoint; a 403 "API function request is invalid" means it is not enabled on the account. ' +
      'Default limit is 8, max 500. Valid `extended` values depend on media type: ' +
      `videos: ${S.VIDEO_EXTENDED.join(', ')}; audio: ${S.AUDIO_EXTENDED.join(', ')}; images: ${S.IMAGE_EXTENDED.join(', ')}.`,
    inputSchema: {
      type: 'object',
      properties: {
        media_type: S.mediaType,
        stock_item_id: S.stockItemId,
        limit: { type: 'integer', minimum: 1, maximum: 500, description: 'Maximum items to return (default 8, max 500).' },
        extended: {
          type: 'array',
          items: { type: 'string', enum: S.ANY_EXTENDED },
          description: 'Additional attributes to include on each result.',
        },
        user_id: S.userId,
        project_id: S.projectId,
      },
      required: ['media_type', 'stock_item_id'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'list_expiring_content',
    title: 'List expiring content',
    description:
      'List stock items that will expire (become undownloadable) within the next 12 months because they were removed from the library. ' +
      'Returned in batches of 1000: { total_results, results_per_page, total_pages, expiring_items: [{ id, expiration_date }] }. ' +
      'Not every API key is entitled to this endpoint; a 403 "API function request is invalid" means it is not enabled on the account.',
    inputSchema: {
      type: 'object',
      properties: { media_type: S.mediaType, page: S.page, user_id: S.userId, project_id: S.projectId },
      required: ['media_type'],
      additionalProperties: false,
    },
    annotations: READ_ONLY,
  },
  {
    name: 'whitelist_youtube_channel',
    title: 'Whitelist YouTube channel',
    description:
      "Register an end user's YouTube channel id so Storyblocks can automatically clear Content ID claims on its royalty-free audio " +
      '(usually within 30 minutes). Returns 201 Created with an empty body on success.',
    inputSchema: {
      type: 'object',
      properties: {
        user_id: { type: 'string', minLength: 1, description: 'Opaque unique identifier for the end user who owns the channel.' },
        youtube_channel_id: { type: 'string', minLength: 1, description: 'YouTube channel id to allowlist (e.g. "UCxxxxxxxxxxxxxxxxxxxxxx").' },
      },
      required: ['user_id', 'youtube_channel_id'],
      additionalProperties: false,
    },
    annotations: MUTATING,
  },
  {
    name: 'file_youtube_audio_dispute',
    title: 'File YouTube audio claim dispute',
    description:
      'File a dispute for a YouTube Content ID claim against Storyblocks audio used in a video. Storyblocks clears ~95% of disputes within 72 hours. ' +
      'The claimant_name must be one of the names returned by list_valid_claimants. Set is_test=1 to validate the request without opening a real dispute.',
    inputSchema: {
      type: 'object',
      properties: {
        disputer_name: { type: 'string', minLength: 1, description: 'Name of the person filing the dispute.' },
        disputer_email: { type: 'string', format: 'email', description: 'Email of the person filing the dispute.' },
        disputed_url: {
          type: 'string',
          format: 'uri',
          pattern: '^https://www\\.youtube\\.com/watch\\?',
          patternDescription: 'must begin with https://www.youtube.com/watch?',
          description: 'Full URL of the disputed YouTube video (must begin with https://www.youtube.com/watch?).',
        },
        claimant_name: { type: 'string', minLength: 1, description: 'Name of the claimant, exactly as returned by list_valid_claimants.' },
        stock_item_id: { ...S.stockItemId, description: 'Id of the audio stock item that is the subject of the claim.' },
        is_test: { type: 'integer', enum: [0, 1], description: 'Set to 1 when testing to avoid opening a real dispute.' },
      },
      required: ['disputer_name', 'disputer_email', 'disputed_url', 'claimant_name', 'stock_item_id'],
      additionalProperties: false,
    },
    annotations: NON_IDEMPOTENT,
  },
  {
    name: 'list_valid_claimants',
    title: 'List valid claimants',
    description:
      'List the YouTube Content ID claimant names whose claims Storyblocks can resolve via file_youtube_audio_dispute. Returns an array of strings.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: READ_ONLY,
  },
  {
    name: 'storyblocks_raw_request',
    title: 'Raw Storyblocks API request',
    description:
      'Send an arbitrary signed request to the Storyblocks API (HMAC auth is added automatically). ' +
      'Use only when no dedicated tool covers the endpoint. `path` must start with /api/v2/. Array query values are joined with commas.',
    inputSchema: {
      type: 'object',
      properties: {
        method: { type: 'string', enum: ['GET', 'POST'], default: 'GET' },
        path: {
          type: 'string',
          pattern: '^/api/v2/[A-Za-z0-9_\\-/.]*$',
          patternDescription: 'must start with /api/v2/ and contain only path characters',
          description: 'Request path, e.g. "/api/v2/videos/search".',
        },
        query: {
          type: 'object',
          description: 'Query parameters (excluding APIKEY/EXPIRES/HMAC, which are added for you).',
        },
        body: { description: 'JSON body for POST requests.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    annotations: NON_IDEMPOTENT,
  },
];

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/**
 * Resolve user_id/project_id from args, falling back to env defaults.
 * When `required` is true (search + download), throw if either is still missing.
 */
function attribution(client, args, required) {
  const user_id = args.user_id !== undefined ? args.user_id : client.defaults.userId;
  const project_id = args.project_id !== undefined ? args.project_id : client.defaults.projectId;
  if (required && (!user_id || !project_id)) {
    throw new Error(
      'Storyblocks requires both user_id and project_id for this request. ' +
        'Pass them as arguments or set STORYBLOCKS_DEFAULT_USER_ID / STORYBLOCKS_DEFAULT_PROJECT_ID.',
    );
  }
  return { user_id, project_id };
}

function withoutAttribution(args) {
  const { user_id, project_id, ...rest } = args; // eslint-disable-line no-unused-vars
  return rest;
}

/**
 * @param {import('./storyblocks').StoryblocksClient} client
 * @param {string} name
 * @param {Record<string, any>} a  validated arguments
 */
async function callTool(client, name, a) {
  switch (name) {
    case 'search_videos':
      return client.search('videos', { ...withoutAttribution(a), ...attribution(client, a, true) });
    case 'search_audio':
      return client.search('audio', { ...withoutAttribution(a), ...attribution(client, a, true) });
    case 'search_images':
      return client.search('images', { ...withoutAttribution(a), ...attribution(client, a, true) });

    case 'get_stock_item_details':
      return client.details(a.media_type, a.stock_item_id, { content_statuses: a.content_statuses, ...attribution(client, a, false) });
    case 'get_stock_items_details_batch': {
      const attr = attribution(client, a, false);
      if (a.page !== undefined || a.results_per_page !== undefined) {
        // Caller asked for a specific upstream page: pass through, but flag the upstream quirk.
        const result = await client.detailsBatch(a.media_type, a.stock_item_ids, {
          page: a.page,
          results_per_page: a.results_per_page,
          content_statuses: a.content_statuses,
          ...attr,
        });
        if (result && result.total_pages > 1 && (a.page || 1) < result.total_pages) {
          result.note = 'Storyblocks reports invalid_stock_ids and stock_ids_not_found only on the final page. Omit page/results_per_page to fetch all pages merged.';
        }
        return result;
      }
      return fetchAllBatchPages(client, a.media_type, a.stock_item_ids, { content_statuses: a.content_statuses, ...attr });
    }
    case 'get_download_links':
      return client.download(a.media_type, a.stock_item_id, attribution(client, a, true));

    case 'list_categories':
      return client.categories(a.media_type, attribution(client, a, false));
    case 'list_collections':
      return paginateCollections(await client.collections(a.media_type, attribution(client, a, false)), a);
    case 'get_collection_items':
      return client.collectionItems(a.media_type, a.collection_id, { page: a.page, ...attribution(client, a, false) });
    case 'find_similar_stock_items':
      return client.similar(a.media_type, a.stock_item_id, { limit: a.limit, extended: a.extended, ...attribution(client, a, false) });
    case 'list_expiring_content':
      return client.expiringContent(a.media_type, { page: a.page, ...attribution(client, a, false) });

    case 'whitelist_youtube_channel': {
      const result = await client.whitelistYouTubeChannel(a);
      return result === null ? { status: 'created', message: 'YouTube channel whitelisted.' } : result;
    }
    case 'file_youtube_audio_dispute': {
      const result = await client.fileAudioDispute(a);
      if (result !== null) return result;
      return { status: 'ok', message: a.is_test === 1 ? 'Test dispute accepted (no dispute opened).' : 'Dispute filed.' };
    }
    case 'list_valid_claimants':
      return client.validClaimants();

    case 'storyblocks_raw_request':
      return client.request({ method: a.method, path: a.path, query: a.query || {}, body: a.body });

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

/**
 * Storyblocks returns the whole batch across upstream pages and only reports
 * invalid_stock_ids / stock_ids_not_found on the last page. Fetch every page
 * and merge so callers always get a complete picture.
 */
async function fetchAllBatchPages(client, media, ids, query) {
  const merged = { total_results: 0, results: { invalid_stock_ids: [], stock_ids_not_found: [], stock_items: [] } };
  let page = 1;
  let totalPages = 1;
  do {
    const r = await client.detailsBatch(media, ids, { ...query, page, results_per_page: ids.length });
    if (!r || !r.results) return r;
    merged.total_results = r.total_results !== undefined ? r.total_results : merged.total_results;
    totalPages = r.total_pages || 1;
    for (const key of ['invalid_stock_ids', 'stock_ids_not_found', 'stock_items']) {
      if (Array.isArray(r.results[key])) merged.results[key].push(...r.results[key]);
    }
    page += 1;
  } while (page <= totalPages && page <= 50);
  merged.pages_fetched = page - 1;
  return merged;
}

/** Page and filter the (unpaginated) upstream collections list client-side. */
function paginateCollections(all, a) {
  const list = Array.isArray(all) ? all : [];
  const needle = a.search ? a.search.toLowerCase() : null;
  const filtered = needle
    ? list.filter((c) => `${c.name || ''} ${c.description || ''}`.toLowerCase().includes(needle))
    : list;
  const perPage = a.results_per_page || 50;
  const page = a.page || 1;
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const slice = filtered.slice((page - 1) * perPage, page * perPage);
  const collections = a.include_description
    ? slice
    : slice.map(({ description, ...rest }) => rest); // eslint-disable-line no-unused-vars
  return { total_results: filtered.length, page, results_per_page: perPage, total_pages: totalPages, collections };
}

function hintForStatus(status, message) {
  const msg = String(message || '');
  switch (status) {
    case 400:
      if (/project id|user id/i.test(msg)) {
        return 'user_id/project_id must contain only letters, numbers, dashes and underscores. Omit them to use the server defaults, or fix STORYBLOCKS_DEFAULT_USER_ID / STORYBLOCKS_DEFAULT_PROJECT_ID.';
      }
      return 'A query parameter is missing or invalid. Check enum values and pagination limits (page * results_per_page <= 10,000).';
    case 401:
    case 403:
      if (/API function request is invalid/i.test(msg)) {
        return 'This endpoint is not enabled for your API key. Your credentials are fine (other endpoints work); the API function must be enabled on your Storyblocks account — contact your Storyblocks account manager or enterprise@storyblocks.com.';
      }
      return 'Authentication failed. Verify STORYBLOCKS_PUBLIC_KEY / STORYBLOCKS_PRIVATE_KEY and that the system clock is accurate (EXPIRES must be in the future, at most 36h ahead).';
    case 404:
      return 'The stock item or collection id does not exist (or is not available to this API key).';
    case 429:
      return 'Rate limit reached for this endpoint. Limits are per-endpoint and lower for test keys.';
    default:
      return undefined;
  }
}

/** Convert a thrown error into the JSON payload returned in an isError tool result. */
function describeError(err) {
  if (err instanceof StoryblocksApiError) {
    const upstream = err.body && typeof err.body === 'object' && 'errors' in err.body ? JSON.stringify(err.body.errors) : String(err.body || '');
    return { error: err.message, status: err.status, path: err.path, response: err.body, hint: hintForStatus(err.status, upstream) };
  }
  return { error: err && err.message ? err.message : String(err) };
}

module.exports = { TOOLS, callTool, describeError, attribution };
