'use strict';

/*
 * Runtime configuration, read from environment variables.
 */

/** Storyblocks caps EXPIRES at 36 hours in the future. */
const MAX_EXPIRES_SECONDS = 36 * 60 * 60;

function readOptional(env, name) {
  const raw = env[name];
  if (raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === '' ? undefined : trimmed;
}

function readInt(env, name, fallback) {
  const raw = readOptional(env, name);
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`${name} must be a positive integer, got "${raw}"`);
  return n;
}

/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ publicKey: string, privateKey: string, baseUrl: string, expiresSeconds: number,
 *            timeoutMs: number, defaultUserId?: string, defaultProjectId?: string }}
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
    defaultUserId: readOptional(env, 'STORYBLOCKS_DEFAULT_USER_ID'),
    defaultProjectId: readOptional(env, 'STORYBLOCKS_DEFAULT_PROJECT_ID'),
  };
}

module.exports = { loadConfig, MAX_EXPIRES_SECONDS };
