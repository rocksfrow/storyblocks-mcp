'use strict';

/*
 * Default user_id / project_id for requests that don't supply their own.
 *
 * Storyblocks requires both on every search and download. They are identifiers
 * in *the integrator's* system — Storyblocks never issues them and its dashboard
 * never mentions them — so there is nothing for an operator to look up. The
 * server therefore generates sensible values instead of asking:
 *
 *   project_id  a fixed slug identifying this integration ("storyblocks-mcp").
 *               The docs attach no PII rule to project_id, so a constant is fine.
 *
 *   user_id     a random opaque id generated once and persisted in the state
 *               dir. Storyblocks uses user_id to collapse repeat downloads of the
 *               same asset by the same person into a single contributor credit,
 *               so it must be (a) stable across restarts — an ephemeral id would
 *               over-credit, (b) distinct per install — a shared constant would
 *               under-credit, and (c) never PII — the raw string is transmitted
 *               (Storyblocks hashes it server-side, the connector does not).
 *
 * Both can be overridden via STORYBLOCKS_DEFAULT_USER_ID / _PROJECT_ID, which is
 * the right thing to do when embedding this server in a multi-user application
 * that already has its own user and project identifiers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHash, randomBytes } = require('crypto');
const { ID_PATTERN } = require('./config');

const DEFAULT_PROJECT_ID = 'storyblocks-mcp';
const USER_ID_FILE = 'user-id';

function generateUserId() {
  return `mcp-${randomBytes(8).toString('hex')}`;
}

/**
 * Load the persisted install id, creating it on first run.
 * If the state dir is unwritable, fall back to a hash of the hostname (stable
 * on this machine, not transmitted raw) and say so on stderr.
 *
 * @param {string} stateDir
 * @param {(msg: string) => void} [warn]
 * @returns {string}
 */
function loadOrCreateUserId(stateDir, warn = (m) => process.stderr.write(`[storyblocks-mcp] ${m}\n`)) {
  const file = path.join(stateDir, USER_ID_FILE);
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (ID_PATTERN.test(existing)) return existing;
    warn(`ignoring malformed id in ${file}; generating a new one`);
  } catch (e) {
    if (e.code !== 'ENOENT') warn(`could not read ${file} (${e.code || e.message}); generating a new id`);
  }

  const fresh = generateUserId();
  try {
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, fresh + '\n', { mode: 0o600 });
    return fresh;
  } catch (e) {
    const fallback = `mcp-${createHash('sha256').update(os.hostname()).digest('hex').slice(0, 16)}`;
    warn(
      `could not persist user id to ${file} (${e.code || e.message}); ` +
        `using a hostname-derived id instead. Set STORYBLOCKS_STATE_DIR to a writable directory or STORYBLOCKS_DEFAULT_USER_ID explicitly.`,
    );
    return fallback;
  }
}

/**
 * @param {ReturnType<import('./config').loadConfig>} config
 * @returns {{ userId: string, projectId: string, userIdSource: 'config'|'generated', projectIdSource: 'config'|'default' }}
 */
function resolveIdentity(config) {
  const userIdSource = config.defaultUserId ? 'config' : 'generated';
  const projectIdSource = config.defaultProjectId ? 'config' : 'default';
  return {
    userId: config.defaultUserId || loadOrCreateUserId(config.stateDir),
    projectId: config.defaultProjectId || DEFAULT_PROJECT_ID,
    userIdSource,
    projectIdSource,
  };
}

module.exports = { resolveIdentity, loadOrCreateUserId, generateUserId, DEFAULT_PROJECT_ID, USER_ID_FILE };
