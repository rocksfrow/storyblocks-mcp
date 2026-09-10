'use strict';

/*
 * JSON Schema fragments shared across tool definitions. Every enum and
 * description here comes from https://documentation.storyblocks.com/.
 */

const mediaType = {
  type: 'string',
  enum: ['videos', 'audio', 'images'],
  description: 'Which Storyblocks library to query: "videos", "audio", or "images".',
};

const stockItemId = {
  type: 'integer',
  minimum: 1,
  description: 'Numeric Storyblocks stock item id (the "id" field returned by search).',
};

/** Charset Storyblocks accepts for user_id / project_id (underscore is accepted despite the API's error text). */
const ID_PATTERN_SOURCE = '^[A-Za-z0-9_-]+$';
const ID_PATTERN_DESCRIPTION = 'may only contain letters, numbers, dashes and underscores (never a name, email, hostname or path)';

const userId = {
  type: 'string',
  pattern: ID_PATTERN_SOURCE,
  patternDescription: ID_PATTERN_DESCRIPTION,
  description:
    'Opaque identifier for the end user, in YOUR system — Storyblocks does not issue these. ' +
    'Usually omit it: the server sends a stable per-install id it generated. Supply it only when embedding this server in a ' +
    'multi-user application that has its own user ids. Letters, numbers, dashes, underscores only; never a name or email ' +
    '(the raw value is transmitted; Storyblocks uses it to de-duplicate repeat downloads for contributor payments).',
};

const projectId = {
  type: 'string',
  pattern: ID_PATTERN_SOURCE,
  patternDescription: ID_PATTERN_DESCRIPTION,
  description:
    'Opaque identifier for the project, in YOUR system. Usually omit it: the server sends "storyblocks-mcp" (or the configured default). ' +
    'Letters, numbers, dashes, underscores only.',
};

const page = { type: 'integer', minimum: 1, description: '1-based page number of results. Defaults to 1.' };

const resultsPerPage = {
  type: 'integer',
  minimum: 1,
  maximum: 250,
  description: 'Number of results per page (default 20, max 250). Note page * results_per_page cannot exceed 10,000.',
};

const contentStatuses = {
  type: 'array',
  items: { type: 'string', minLength: 1 },
  description: 'Content statuses to include, e.g. ["active"] or ["active","inactive"]. Defaults to active,inactive.',
};

const stringList = (description) => ({ type: 'array', items: { type: 'string', minLength: 1 }, description });
const enumList = (values, description) => ({ type: 'array', items: { type: 'string', enum: values }, description });
const bool = (description) => ({ type: 'boolean', description });
const nonNegInt = (description) => ({ type: 'integer', minimum: 0, description });

const VIDEO_EXTENDED = [
  'download_formats', 'keywords', 'isSensitiveContent', 'categories', 'description', 'isEditorial', 'isStereo',
  'hasTalentReleased', 'hasPropertyReleased', 'hasAudio', 'hasAlpha', 'maxResolution', 'aspectRatio', 'dateAdded', 'durationMs',
];
const AUDIO_EXTENDED = [
  'download_formats', 'keywords', 'isSensitiveContent', 'bpm', 'moods', 'genres', 'instruments', 'soundEffects',
  'hasTalentReleased', 'hasPropertyReleased', 'durationMs', 'topTags', 'dateAdded', 'artists', 'pro', 'publisher', 'publisherPro',
];
const IMAGE_EXTENDED = [
  'download_formats', 'keywords', 'isSensitiveContent', 'hasTalentReleased', 'hasPropertyReleased', 'categories',
  'description', 'isEditorial', 'aspectRatio', 'dateAdded', 'colors',
];
const ANY_EXTENDED = [...new Set([...VIDEO_EXTENDED, ...AUDIO_EXTENDED, ...IMAGE_EXTENDED])];

/** Search parameters shared by all three media types. */
const commonSearch = {
  keywords: { type: 'string', description: 'Free-text search terms. Multiple terms may be separated with commas.' },
  required_keywords: stringList('Content must match ALL of these keywords.'),
  filtered_keywords: stringList('Content must NOT match any of these keywords.'),
  categories: {
    type: 'array',
    items: { anyOf: [{ type: 'integer' }, { type: 'string', minLength: 1 }] },
    description: 'Category ids to restrict results to (from list_categories). Pass the matching content_type for those categories.',
  },
  contributor_id: { type: 'integer', description: 'Restrict results to a single contributor id.' },
  safe_search: bool('When true, only return SAFE_FOR_WORK content.'),
  page,
  results_per_page: resultsPerPage,
  sort_by: {
    type: 'string',
    enum: ['most_relevant', 'most_downloaded', 'most_recent', 'trending_now', 'undiscovered'],
    description: 'Sort results by an internal metric. Defaults to most_relevant.',
  },
  sort_order: { type: 'string', enum: ['ASC', 'DESC'], description: 'Sort direction.' },
  user_id: userId,
  project_id: projectId,
};

const videoSearch = {
  type: 'object',
  properties: {
    ...commonSearch,
    content_type: enumList(['footage', 'motionbackgrounds', 'templates', 'all'], 'Video content types to include. Defaults to all.'),
    quality: { type: 'string', enum: ['HD', '4K', 'ALL'], description: 'Minimum quality available. Defaults to ALL.' },
    min_duration: nonNegInt('Minimum duration in seconds.'),
    max_duration: nonNegInt('Maximum duration in seconds.'),
    has_talent_released: bool('Filter by presence of a Talent Release form.'),
    has_property_released: bool('Filter by presence of a Property Release form.'),
    has_alpha: bool('Only content with an alpha channel.'),
    is_editorial: bool('Filter content flagged for editorial use.'),
    is_vr_360: bool('Include only (true) or exclude (false) VR/360° content.'),
    frame_rates: enumList(['24', '25', '30', '50', '60'], 'Frame rates to include.'),
    orientation: { type: 'string', enum: ['horizontal', 'vertical', 'all'], description: 'Video orientation filter.' },
    extended: enumList(VIDEO_EXTENDED, 'Additional attributes to include on each result.'),
  },
  additionalProperties: false,
};

const audioSearch = {
  type: 'object',
  properties: {
    ...commonSearch,
    content_type: enumList(['music', 'sfx', 'all'], 'Audio content types to include. Defaults to all.'),
    min_duration: nonNegInt('Minimum duration in seconds.'),
    max_duration: nonNegInt('Maximum duration in seconds.'),
    min_bpm: nonNegInt('Minimum beats per minute (music only).'),
    max_bpm: nonNegInt('Maximum beats per minute (music only).'),
    has_vocals: bool('Filter for tracks with (true) or without (false) vocals.'),
    extended: enumList(AUDIO_EXTENDED, 'Additional attributes to include on each result.'),
  },
  additionalProperties: false,
};

const imageSearch = {
  type: 'object',
  properties: {
    ...commonSearch,
    content_type: enumList(
      ['photos', 'illustrations', 'vectors', 'snapshots', 'all'],
      'Image content types to include. Defaults to all — leave it unset unless you specifically need illustrations or vectors: ' +
        'over 99% of the image library (including ordinary photography) is typed "snapshots", so filtering to ["photos"] discards almost everything.',
    ),
    orientation: { type: 'string', enum: ['portrait', 'square', 'landscape', 'all'], description: 'Image orientation filter. Defaults to all.' },
    color: {
      type: 'string',
      pattern: '^#?[0-9a-fA-F]{6}$',
      patternDescription: 'must be a 6-digit hex value such as #BADA55',
      description: '6-character hex color (e.g. "#BADA55"); only images containing this color are returned.',
    },
    has_transparency: bool('Filter by presence of an alpha channel.'),
    has_talent_released: bool('Filter by presence of a Talent Release form.'),
    has_property_released: bool('Filter by presence of a Property Release form.'),
    is_editorial: bool('Filter content flagged for editorial use.'),
    extended: enumList(IMAGE_EXTENDED, 'Additional attributes to include on each result.'),
  },
  additionalProperties: false,
};

module.exports = {
  ID_PATTERN_SOURCE,
  ID_PATTERN_DESCRIPTION,
  mediaType,
  stockItemId,
  userId,
  projectId,
  page,
  resultsPerPage,
  contentStatuses,
  videoSearch,
  audioSearch,
  imageSearch,
  VIDEO_EXTENDED,
  AUDIO_EXTENDED,
  IMAGE_EXTENDED,
  ANY_EXTENDED,
};
