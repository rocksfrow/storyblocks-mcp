'use strict';

/*
 * Condensed reference for the Storyblocks API v2, exposed as an MCP resource so
 * clients can ground themselves without leaving the protocol.
 *
 * Source: https://documentation.storyblocks.com/
 */

const API_OVERVIEW = `# Storyblocks API v2 — condensed reference

Base URL: https://api.storyblocks.com
All media families share one host and one URL shape: /api/v2/{videos|audio|images}/...

## Authentication (HMAC)
Every request needs three query params:
- APIKEY  — your public key
- EXPIRES — unix seconds; must be in the future, at most 36 hours ahead
- HMAC    — hex(HMAC-SHA256(key = privateKey + EXPIRES, data = resource path))
The "resource" is the URL path only (e.g. /api/v2/videos/stock-item/details/12345), no host, no query string.
Auth failures return 40x with { "errors": "..." }.

## Required attribution
user_id and project_id are required on all search and download requests. They are identifiers in the *integrator's*
system — Storyblocks does not issue them. Charset: letters, numbers, dashes, underscores (the API only enforces this on
project_id; user_id is accepted verbatim, so never send names/emails). They tie downloads to searches, aid support
replay, and de-duplicate repeat downloads for contributor revenue share, so user_id must be stable per person.
This server defaults project_id to "storyblocks-mcp" and user_id to a random per-install id persisted in
~/.storyblocks-mcp/user-id (override with STORYBLOCKS_DEFAULT_* or per call).

## Limits
Rate limits are per endpoint and per client; test keys have lower limits than full-access keys.
Search returns at most 10,000 results (results_per_page <= 250; page * results_per_page <= 10,000).

## Endpoints (replace {m} with videos | audio | images)
GET  /api/v2/{m}/search                         Search. Common filters: keywords, required_keywords, filtered_keywords,
                                                categories, contributor_id, safe_search, page, results_per_page,
                                                sort_by (most_relevant|most_downloaded|most_recent|trending_now|undiscovered),
                                                sort_order (ASC|DESC), extended.
    videos extras: content_type (footage|motionbackgrounds|templates|all), quality (HD|4K|ALL), min/max_duration,
                   has_talent_released, has_property_released, has_alpha, is_editorial, is_vr_360,
                   frame_rates (24,25,30,50,60), orientation (horizontal|vertical|all)
    audio  extras: content_type (music|sfx|all), min/max_duration, min/max_bpm, has_vocals
    images extras: content_type (photos|illustrations|vectors|snapshots|all), orientation (portrait|square|landscape|all),
                   color (#RRGGBB), has_transparency, has_talent_released, has_property_released, is_editorial
    Response: { total_results, results: [StockItemSummary] }

GET  /api/v2/{m}/stock-item/details/{id}        Full metadata + download_formats. Optional content_statuses (default active,inactive).
POST /api/v2/{m}/stock-item/details             Batch details. Body { "stockItemIds": [...] }; query page, results_per_page (default 10), content_statuses.
                                                Response: { total_results, total_pages, results: { invalid_stock_ids, stock_ids_not_found, stock_items } }
GET  /api/v2/{m}/stock-item/download/{id}       Full-quality download URLs keyed by format. Requires user_id, project_id.
                                                videos: { MP4: { _1080p, _720p }, MOV: {...} }  audio: { MP3, WAV }  images: { JPG, EPS, PDF, PSD }
                                                Licensed download event (counts against download limit). URLs are CloudFront-signed
                                                and expire ~30 min after issue — fetch immediately, never persist.
GET  /api/v2/{m}/stock-item/categories          [{ id, name, content_type, category_group? }]
GET  /api/v2/{m}/collections                    [{ id, name, description, num_items, date_added, date_updated }]
GET  /api/v2/{m}/collections/{collection_id}    Items in a collection, 100 per page (query: page).
GET  /api/v2/{m}/stock-item/similar/{id}        Similar items. query: limit (default 8, max 500), extended.
GET  /api/v2/{m}/stock-item/expiring-content    Items expiring within 12 months, 1000 per page.
                                                { total_results, results_per_page, total_pages, expiring_items: [{ id, expiration_date }] }

POST /api/v2/audio/whitelist/youtube            query: user_id, youtube_channel_id → 201 Created (empty body)
POST /api/v2/audio/dispute                      query: disputer_name, disputer_email, disputed_url (https://www.youtube.com/watch?...),
                                                claimant_name, stock_item_id, is_test (0|1) → 200 OK
GET  /api/v2/audio/dispute/valid-claimants      [ "Storyblocks", ... ]

## StockItemSummary fields
Common: id, title, type, contentClass (video|audio|image), is_new, thumbnail_url
Video:  preview_urls { _180p, _360p, _480p, _720p }, duration, durationMs, orientation
Audio:  preview_url, waveform_url, duration, durationMs, bpm
Image:  preview_url (details also include small_preview_url, aspect_ratio)

## Extended attributes (per media type)
videos: download_formats, keywords, isSensitiveContent, categories, description, isEditorial, isStereo, hasTalentReleased,
        hasPropertyReleased, hasAudio, hasAlpha, maxResolution, aspectRatio, dateAdded, durationMs
audio:  download_formats, keywords, isSensitiveContent, bpm, moods, genres, instruments, soundEffects, hasTalentReleased,
        hasPropertyReleased, durationMs, topTags, dateAdded, artists, pro, publisher, publisherPro
images: download_formats, keywords, isSensitiveContent, hasTalentReleased, hasPropertyReleased, categories, description,
        isEditorial, aspectRatio, dateAdded, colors

## Errors
400 { "errors": "..." } invalid/missing query param · 403 { "errors": "..." } auth failure · 404 { "errors": "..." } not found
403 { "errors": "API function request is invalid." } = endpoint not enabled for this key (seen on similar and
expiring-content with test keys); credentials are fine, the entitlement is missing.

## Notes
- Content returned by search/collections may differ from storyblocks.com due to licensing differences.
- Removed content stays downloadable for 12 months (see expiring-content).
- Image content_type: >99% of the image library is typed "snapshots" (including ordinary photos); leave the filter unset.
- Preview/thumbnail URLs are public, unsigned and safe to store; only /content/ download URLs are signed and short-lived.
- Observed inconsistencies: summary "type" is lowercase ("footage") while details "type" is title-cased ("Footage");
  details content_type uses "motion-backgrounds"/"sound-effects" while search filters use "motionbackgrounds"/"sfx";
  motion backgrounds omit orientation; extended maxResolution in search may be null even when details show 4K.
- Test keys: https://developer.storyblocks.com/register · Sales: enterprise@storyblocks.com
`;

module.exports = { API_OVERVIEW };
