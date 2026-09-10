'use strict';

/*
 * Runtime configuration, read from environment variables.
 */

const os = require('os');
const path = require('path');

/** Storyblocks caps EXPIRES at 36 hours in the future. */
const MAX_EXPIRES_SECONDS = 36 * 60 * 60;

/**
 * Characters Storyblocks accepts in user_id / project_id. The API's own error
 * message says "letters, numbers, and dashes" but underscores are accepted too
 * (verified against the live API). Dots, spaces, colons, slashes and "@" are
 * rejected — which also rules out emails, hostnames and file paths.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ID_RULE = 'may only contain letters, numbers, dashes and underscores (no spaces, dots, "@", or slashes — never use a name or email)';

/**
 * Claude Desktop substitutes `${user_config.x}` in manifest env values. When an
 * optional field is left blank the template is passed through *unreplaced*, so
 * the server receives the literal string "${user_config.default_user_id}".
 * Treat any such value as unset.
 */
function isUnreplacedTemplate(value) {
  return /^\$\{[^}]*\}$/.test(value);
}

function readOptional(env, name) {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  if (trimmed === '' || isUnreplacedTemplate(trimmed)) return undefined;
  return trimmed;
}

function readInt(env, name, fallback) {
  const raw = readOptional(env, name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

/** Validate an operator-supplied id up front so a bad value fails at startup, not on the first API call. */
function readId(env, name) {
  const value = readOptional(env, name);
  if (value === undefined) return undefined;
  if (!ID_PATTERN.test(value)) throw new Error(`${name} ${ID_RULE}; got "${value}"`);
  return value;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ publicKey: string, privateKey: string, baseUrl: string, expiresSeconds: number,
 *            timeoutMs: number, stateDir: string, defaultUserId?: string, defaultProjectId?: string }}
 */
function loadConfig(env = process.env) {
  const publicKey = readOptional(env, 'STORYBLOCKS_PUBLIC_KEY');
  const privateKey = readOptional(env, 'STORYBLOCKS_PRIVATE_KEY');
  if (!publicKey || !privateKey) {
    throw new Error(
      'STORYBLOCKS_PUBLIC_KEY and STORYBLOCKS_PRIVATE_KEY must be set. ' +
        'Request test keys at https://developer.storyblocks.com/register',
    );
  }

  const expiresSeconds = readInt(env, 'STORYBLOCKS_EXPIRES_SECONDS', 300);
  if (expiresSeconds > MAX_EXPIRES_SECONDS) {
    throw new Error(`STORYBLOCKS_EXPIRES_SECONDS cannot exceed ${MAX_EXPIRES_SECONDS} (36 hours), got ${expiresSeconds}`);
  }

  return {
    publicKey,
    privateKey,
    baseUrl: (readOptional(env, 'STORYBLOCKS_BASE_URL') || 'https://api.storyblocks.com').replace(/\/+$/, ''),
    expiresSeconds,
    timeoutMs: readInt(env, 'STORYBLOCKS_TIMEOUT_MS', 30000),
    stateDir: readOptional(env, 'STORYBLOCKS_STATE_DIR') || path.join(os.homedir(), '.storyblocks-mcp'),
    defaultUserId: readId(env, 'STORYBLOCKS_DEFAULT_USER_ID'),
    defaultProjectId: readId(env, 'STORYBLOCKS_DEFAULT_PROJECT_ID'),
  };
}

module.exports = { loadConfig, MAX_EXPIRES_SECONDS, ID_PATTERN, ID_RULE, isUnreplacedTemplate };
