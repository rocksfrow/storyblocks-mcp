'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const { loadConfig, isUnreplacedTemplate } = require('../server/config');
const { resolveIdentity, loadOrCreateUserId, DEFAULT_PROJECT_ID, USER_ID_FILE } = require('../server/identity');

const base = { STORYBLOCKS_PUBLIC_KEY: 'pub', STORYBLOCKS_PRIVATE_KEY: 'priv' };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-'));

test('unreplaced Claude Desktop ${user_config.*} templates are treated as unset', () => {
  assert.equal(isUnreplacedTemplate('${user_config.default_user_id}'), true);
  assert.equal(isUnreplacedTemplate('mcp-abc'), false);
  const cfg = loadConfig({
    ...base,
    STORYBLOCKS_DEFAULT_USER_ID: '${user_config.default_user_id}',
    STORYBLOCKS_DEFAULT_PROJECT_ID: '${user_config.default_project_id}',
    STORYBLOCKS_BASE_URL: '${user_config.nope}',
  });
  assert.equal(cfg.defaultUserId, undefined);
  assert.equal(cfg.defaultProjectId, undefined);
  assert.equal(cfg.baseUrl, 'https://api.storyblocks.com');
});

test('configured ids are validated at startup against the Storyblocks charset', () => {
  assert.equal(loadConfig({ ...base, STORYBLOCKS_DEFAULT_USER_ID: 'user_1-A' }).defaultUserId, 'user_1-A');
  for (const bad of ['kyle@example.com', 'Kyles-MacBook.local', 'has space', 'a/b', 'a:b']) {
    assert.throws(() => loadConfig({ ...base, STORYBLOCKS_DEFAULT_USER_ID: bad }), /STORYBLOCKS_DEFAULT_USER_ID/, bad);
    assert.throws(() => loadConfig({ ...base, STORYBLOCKS_DEFAULT_PROJECT_ID: bad }), /STORYBLOCKS_DEFAULT_PROJECT_ID/, bad);
  }
});

test('identity: generated user id is random, well-formed, persisted, and stable across loads', () => {
  const dir = tmp();
  const cfg = loadConfig({ ...base, STORYBLOCKS_STATE_DIR: dir });
  const first = resolveIdentity(cfg);
  assert.match(first.userId, /^mcp-[0-9a-f]{16}$/);
  assert.equal(first.userIdSource, 'generated');
  assert.equal(first.projectId, DEFAULT_PROJECT_ID);
  assert.equal(first.projectIdSource, 'default');
  assert.equal(fs.readFileSync(path.join(dir, USER_ID_FILE), 'utf8').trim(), first.userId);
  const mode = fs.statSync(path.join(dir, USER_ID_FILE)).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o600);

  const second = resolveIdentity(cfg);
  assert.equal(second.userId, first.userId, 'must be stable across restarts');

  const other = resolveIdentity(loadConfig({ ...base, STORYBLOCKS_STATE_DIR: tmp() }));
  assert.notEqual(other.userId, first.userId, 'must be distinct per install');
});

test('identity: configured values win over generated defaults', () => {
  const dir = tmp();
  const id = resolveIdentity(loadConfig({ ...base, STORYBLOCKS_STATE_DIR: dir, STORYBLOCKS_DEFAULT_USER_ID: 'app-user-7', STORYBLOCKS_DEFAULT_PROJECT_ID: 'my_project' }));
  assert.deepEqual(id, { userId: 'app-user-7', projectId: 'my_project', userIdSource: 'config', projectIdSource: 'config' });
  assert.equal(fs.existsSync(path.join(dir, USER_ID_FILE)), false, 'no file written when overridden');
});

test('identity: malformed persisted id is replaced; unwritable state dir falls back with a warning', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, USER_ID_FILE), 'bad value@\n');
  const warnings = [];
  const id = loadOrCreateUserId(dir, (m) => warnings.push(m));
  assert.match(id, /^mcp-[0-9a-f]{16}$/);
  assert.equal(warnings.length, 1);

  const file = path.join(tmp(), 'not-a-dir');
  fs.writeFileSync(file, '');
  const w2 = [];
  const fallback = loadOrCreateUserId(path.join(file, 'child'), (m) => w2.push(m));
  assert.match(fallback, /^mcp-[0-9a-f]{16}$/);
  assert.ok(w2.some((m) => /could not persist/.test(m)));
});
