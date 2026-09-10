'use strict';

/*
 * End-to-end: start a mock Storyblocks API, spawn the MCP server over stdio
 * pointed at it, and drive it with raw JSON-RPC. Verifies protocol handshake,
 * tool listing, request signing, parameter serialization, and error handling.
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHmac } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { test, before, after } = require('node:test');

const PUB = 'pubkey';
const PRIV = 'privkey';
const SERVER = path.join(__dirname, '..', 'server', 'index.js');

const seen = [];
let mock;
let baseUrl;

before(async () => {
  mock = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      seen.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });
      const expires = url.searchParams.get('EXPIRES');
      const hmac = createHmac('sha256', PRIV + expires).update(url.pathname).digest('hex');
      if (url.searchParams.get('APIKEY') !== PUB || url.searchParams.get('HMAC') !== hmac) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ errors: 'bad auth' }));
      }
      if (url.pathname.endsWith('/details/404')) {
        res.writeHead(404, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ errors: 'Stock item not found' }));
      }
      // Storyblocks validates project_id charset (underscore allowed) but not user_id.
      const pid = url.searchParams.get('project_id');
      if (pid !== null && !/^[A-Za-z0-9_-]+$/.test(pid)) {
        res.writeHead(400, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ errors: { project_id: ['The project id may only contain letters, numbers, and dashes.'] } }));
      }
      // Upstream quirk (B7): required_keywords yields zero results with no error.
      if (url.pathname.endsWith('/search') && url.searchParams.has('required_keywords')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ total_results: 0, results: [] }));
      }
      // Entitlement-gated endpoint.
      if (url.pathname.includes('/stock-item/similar/')) {
        res.writeHead(403, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ errors: 'API function request is invalid.' }));
      }
      // Batch details: emulate upstream pagination where invalid/not-found ids appear only on the last page.
      if (req.method === 'POST' && url.pathname.endsWith('/stock-item/details')) {
        const ids = JSON.parse(body).stockItemIds;
        const invalid = ids.filter((x) => !/^\d+$/.test(String(x)));
        const numeric = ids.filter((x) => /^\d+$/.test(String(x))).map(Number);
        const notFound = numeric.filter((n) => n >= 900000000);
        const found = numeric.filter((n) => n < 900000000);
        const per = Number(url.searchParams.get('results_per_page') || 10);
        const page = Number(url.searchParams.get('page') || 1);
        const totalPages = Math.max(1, Math.ceil(found.length / per));
        const last = page >= totalPages;
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(
          JSON.stringify({
            total_results: ids.length,
            total_pages: totalPages,
            results: {
              invalid_stock_ids: last ? invalid : [],
              stock_ids_not_found: last ? notFound : [],
              stock_items: found.slice((page - 1) * per, page * per).map((id) => ({ id, title: `Item ${id}` })),
            },
          }),
        );
      }
      // Collections: upstream returns the whole list at once.
      if (/\/collections$/.test(url.pathname)) {
        const all = Array.from({ length: 340 }, (_, i) => ({
          id: 1000 + i, name: i % 7 === 0 ? `Crypto set ${i}` : `Collection ${i}`, description: 'x'.repeat(120), num_items: 6,
          date_added: '2018-11-10 16:33:30', date_updated: '2018-11-10 16:41:23',
        }));
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify(all));
      }
      if (url.pathname === '/api/v2/audio/whitelist/youtube') {
        res.writeHead(201);
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, path: url.pathname, method: req.method, body: body ? JSON.parse(body) : null }));
    });
  });
  await new Promise((r) => mock.listen(0, '127.0.0.1', r));
  baseUrl = `http://127.0.0.1:${mock.address().port}`;
});

after(() => mock.close());

/** Spawn the server and return a tiny JSON-RPC client. */
function startServer(extraEnv = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      PATH: process.env.PATH,
      STORYBLOCKS_PUBLIC_KEY: PUB,
      STORYBLOCKS_PRIVATE_KEY: PRIV,
      STORYBLOCKS_BASE_URL: baseUrl,
      STORYBLOCKS_STATE_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-state-')),
      STORYBLOCKS_DEFAULT_USER_ID: 'u-1',
      STORYBLOCKS_DEFAULT_PROJECT_ID: 'p-1',
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const pending = new Map();
  let nextId = 1;
  let exited = null;
  // If the server dies, fail every outstanding request instead of hanging the suite.
  child.on('exit', (code) => {
    exited = new Error(`server exited with code ${code}\n${stderr}`);
    for (const [, { reject }] of pending) reject(exited);
    pending.clear();
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p.resolve(msg);
    }
  });
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      if (exited) return reject(exited);
      const id = nextId++;
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const call = async (name, args) => {
    const msg = await request('tools/call', { name, arguments: args });
    if (msg.error) return { rpcError: msg.error };
    const r = msg.result;
    return { isError: !!r.isError, text: r.content[0].text, json: safeJson(r.content[0].text) };
  };
  return { child, request, notify, call, stderr: () => stderr, close: () => child.stdin.end() };
}

function safeJson(t) {
  try {
    return JSON.parse(t);
  } catch (_) {
    return undefined;
  }
}

test('server exits with a clear message when keys are missing', async () => {
  const child = spawn(process.execPath, [SERVER], { env: { PATH: process.env.PATH }, stdio: ['pipe', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 1);
  assert.match(stderr, /STORYBLOCKS_PUBLIC_KEY/);
});

test('full protocol flow against a mock API', async () => {
  const s = startServer();
  try {
    // initialize
    const init = await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'storyblocks-mcp');
    assert.equal(init.result.serverInfo.version, require('../package.json').version);
    assert.ok(init.result.capabilities.tools && init.result.capabilities.resources);
    s.notify('notifications/initialized');

    assert.deepEqual((await s.request('ping')).result, {});

    // tools/list
    const tools = (await s.request('tools/list')).result.tools;
    assert.equal(tools.length, 15);
    assert.ok(tools.every((t) => t.inputSchema && t.annotations));

    // resources
    const resources = (await s.request('resources/list')).result.resources;
    assert.equal(resources[0].uri, 'storyblocks://docs/api-overview');
    const doc = (await s.request('resources/read', { uri: 'storyblocks://docs/api-overview' })).result;
    assert.match(doc.contents[0].text, /HMAC/);
    assert.equal((await s.request('resources/read', { uri: 'storyblocks://nope' })).error.code, -32002);
    assert.equal((await s.request('bogus/method')).error.code, -32601);

    // search: arrays/booleans serialized, env-default attribution
    let r = await s.call('search_videos', {
      keywords: 'ocean sunset',
      content_type: ['footage', 'motionbackgrounds'],
      frame_rates: ['24', '30'],
      has_alpha: false,
      extended: ['download_formats', 'durationMs'],
      results_per_page: 5,
    });
    assert.equal(r.isError, false, r.text);
    let last = seen.at(-1);
    assert.equal(last.path, '/api/v2/videos/search');
    assert.equal(last.query.content_type, 'footage,motionbackgrounds');
    assert.equal(last.query.frame_rates, '24,30');
    assert.equal(last.query.has_alpha, 'false');
    assert.equal(last.query.extended, 'download_formats,durationMs');
    assert.equal(last.query.user_id, 'u-1');
    assert.equal(last.query.project_id, 'p-1');
    assert.equal(last.query.results_per_page, '5');

    // required_keywords: wire format is the documented comma-separated string; an empty result gets a hint (B7)
    r = await s.call('search_videos', { keywords: 'sunset', required_keywords: ['sunset', 'ocean'] });
    assert.equal(r.isError, false);
    assert.equal(seen.at(-1).query.required_keywords, 'sunset,ocean');
    assert.equal(r.json.total_results, 0);
    assert.match(r.json.hint, /required_keywords/);
    r = await s.call('search_videos', { keywords: 'sunset' });
    assert.equal(r.json.hint, undefined, 'no hint when the filter was not used');

    // explicit attribution overrides env default
    r = await s.call('search_audio', { keywords: 'jazz', min_bpm: 90, user_id: 'u-2', project_id: 'p-2' });
    assert.equal(r.isError, false);
    assert.equal(seen.at(-1).query.user_id, 'u-2');
    assert.equal(seen.at(-1).query.min_bpm, '90');

    // invalid args -> JSON-RPC -32602 with details, no HTTP call made
    const before = seen.length;
    r = await s.call('search_images', { orientation: 'diagonal' });
    assert.equal(r.rpcError.code, -32602);
    assert.ok(r.rpcError.data.errors.some((e) => e.includes('orientation')));
    assert.equal(seen.length, before);
    r = await s.call('no_such_tool', {});
    assert.equal(r.rpcError.code, -32602);

    // batch details, explicit page: POST body + query passed through, plus a note about the upstream quirk
    r = await s.call('get_stock_items_details_batch', { media_type: 'images', stock_item_ids: [1, 2, 3, 'abc'], results_per_page: 2, page: 1 });
    assert.equal(r.isError, false);
    last = seen.at(-1);
    assert.equal(last.method, 'POST');
    assert.equal(last.path, '/api/v2/images/stock-item/details');
    assert.deepEqual(JSON.parse(last.body), { stockItemIds: [1, 2, 3, 'abc'] });
    assert.equal(last.query.results_per_page, '2');
    assert.deepEqual(r.json.results.invalid_stock_ids, [], 'mock hides invalid ids on non-final page');
    assert.match(r.json.note, /final page/);

    // batch details, default: all upstream pages fetched and merged so rejection lists are complete (B3)
    const before3 = seen.length;
    r = await s.call('get_stock_items_details_batch', { media_type: 'videos', stock_item_ids: [10923156, 11087451, 999999999, 'not-a-number'] });
    assert.equal(r.isError, false, r.text);
    assert.equal(seen.length - before3, 1, 'single upstream page when results_per_page = ids.length');
    assert.equal(seen.at(-1).query.results_per_page, '4');
    assert.deepEqual(r.json.results.stock_items.map((i) => i.id), [10923156, 11087451]);
    assert.deepEqual(r.json.results.invalid_stock_ids, ['not-a-number']);
    assert.deepEqual(r.json.results.stock_ids_not_found, [999999999]);

    // list_collections is paged client-side (B2)
    r = await s.call('list_collections', { media_type: 'videos' });
    assert.equal(r.isError, false);
    assert.equal(r.json.total_results, 340);
    assert.equal(r.json.total_pages, 7);
    assert.equal(r.json.collections.length, 50);
    assert.equal(r.json.collections[0].description, undefined, 'description omitted by default');
    assert.ok(r.text.length < 12000, `response should be compact, got ${r.text.length} bytes`);
    r = await s.call('list_collections', { media_type: 'videos', search: 'crypto', results_per_page: 10, page: 2, include_description: true });
    assert.equal(r.json.total_results, 49);
    assert.equal(r.json.page, 2);
    assert.equal(r.json.collections.length, 10);
    assert.ok(r.json.collections.every((c) => /Crypto/.test(c.name) && c.description));

    // 403 "API function request is invalid" -> entitlement hint, not a credentials hint (B4)
    r = await s.call('find_similar_stock_items', { media_type: 'videos', stock_item_id: 10923156 });
    assert.equal(r.isError, true);
    assert.equal(r.json.status, 403);
    assert.match(r.json.hint, /not enabled for your API key/);
    assert.doesNotMatch(r.json.hint, /clock/);

    // upstream project_id charset 400 -> targeted hint
    r = await s.call('search_videos', { keywords: 'x', project_id: 'ok-id', user_id: 'ok' });
    assert.equal(r.isError, false);
    r = await s.call('storyblocks_raw_request', { path: '/api/v2/videos/search', query: { user_id: 'u', project_id: 'has.dot' } });
    assert.equal(r.isError, true);
    assert.match(r.json.hint, /letters, numbers, dashes and underscores/);

    // ids with illegal chars are rejected by schema before any HTTP call (B6: underscore allowed)
    const before6 = seen.length;
    r = await s.call('search_videos', { keywords: 'x', user_id: 'test.person@example.com' });
    assert.equal(r.rpcError.code, -32602);
    assert.equal(seen.length, before6);
    r = await s.call('search_videos', { keywords: 'x', user_id: 'under_score', project_id: 'also_ok' });
    assert.equal(r.isError, false);

    // path param signed; 404 surfaced as isError with hint
    r = await s.call('get_stock_item_details', { media_type: 'audio', stock_item_id: 404 });
    assert.equal(r.isError, true);
    assert.equal(r.json.status, 404);
    assert.ok(r.json.hint);
    assert.equal(r.json.path, '/api/v2/audio/stock-item/details/404');

    // remaining read endpoints
    r = await s.call('get_download_links', { media_type: 'videos', stock_item_id: 11851 });
    assert.equal(r.isError, false);
    assert.equal(seen.at(-1).path, '/api/v2/videos/stock-item/download/11851');
    r = await s.call('get_collection_items', { media_type: 'audio', collection_id: 51392, page: 2 });
    assert.equal(r.isError, false);
    assert.equal(seen.at(-1).path, '/api/v2/audio/collections/51392');
    for (const [name, args] of [
      ['list_expiring_content', { media_type: 'videos' }],
      ['list_categories', { media_type: 'audio' }],
      ['list_valid_claimants', {}],
    ]) {
      r = await s.call(name, args);
      assert.equal(r.isError, false, name);
    }

    // whitelist: 201 empty body -> friendly message
    r = await s.call('whitelist_youtube_channel', { user_id: 'u-9', youtube_channel_id: 'UCabc' });
    assert.equal(r.isError, false, r.text);
    assert.match(r.text, /whitelisted/);

    // dispute: is_test forwarded
    r = await s.call('file_youtube_audio_dispute', {
      disputer_name: 'K',
      disputer_email: 'k@example.com',
      disputed_url: 'https://www.youtube.com/watch?v=abc',
      claimant_name: 'Storyblocks',
      stock_item_id: 1,
      is_test: 1,
    });
    assert.equal(r.isError, false, r.text);
    assert.equal(seen.at(-1).query.is_test, '1');

    // raw request: default method applied, auth params cannot be overridden
    r = await s.call('storyblocks_raw_request', { path: '/api/v2/videos/collections', query: { page: 3, APIKEY: 'attacker' } });
    assert.equal(r.isError, false, r.text);
    assert.equal(seen.at(-1).method, 'GET');
    assert.equal(seen.at(-1).query.page, '3');
    assert.equal(seen.at(-1).query.APIKEY, PUB);
  } finally {
    s.close();
  }
});

test('blank / unreplaced-template config falls back to generated, persisted defaults (B1)', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-mcp-state-'));
  // Exactly what Claude Desktop sends when the optional fields are left blank.
  const env = {
    STORYBLOCKS_STATE_DIR: stateDir,
    STORYBLOCKS_DEFAULT_USER_ID: '${user_config.default_user_id}',
    STORYBLOCKS_DEFAULT_PROJECT_ID: '${user_config.default_project_id}',
  };
  let s = startServer(env);
  let generated;
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    const r = await s.call('search_videos', { keywords: 'x' });
    assert.equal(r.isError, false, r.text);
    generated = seen.at(-1).query.user_id;
    assert.match(generated, /^mcp-[0-9a-f]{16}$/);
    assert.equal(seen.at(-1).query.project_id, 'storyblocks-mcp');
    assert.equal(fs.readFileSync(path.join(stateDir, 'user-id'), 'utf8').trim(), generated);
    assert.match(s.stderr(), /user_id generated, project_id "storyblocks-mcp" default/);
  } finally {
    s.close();
  }
  // Restart: same id.
  s = startServer(env);
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    await s.call('search_audio', { keywords: 'y' });
    assert.equal(seen.at(-1).query.user_id, generated, 'stable across restarts');
  } finally {
    s.close();
  }
});

test('invalid configured ids fail at startup with a clear message', async () => {
  const child = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, STORYBLOCKS_PUBLIC_KEY: PUB, STORYBLOCKS_PRIVATE_KEY: PRIV, STORYBLOCKS_DEFAULT_PROJECT_ID: 'Kyles-MacBook.local' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 1);
  assert.match(stderr, /STORYBLOCKS_DEFAULT_PROJECT_ID/);
  assert.match(stderr, /letters, numbers, dashes and underscores/);
});
