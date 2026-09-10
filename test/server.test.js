'use strict';

/*
 * End-to-end: start a mock Storyblocks API, spawn the MCP server over stdio
 * pointed at it, and drive it with raw JSON-RPC. Verifies protocol handshake,
 * tool listing, request signing, parameter serialization, and error handling.
 */

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHmac } = require('node:crypto');
const http = require('node:http');
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
      STORYBLOCKS_DEFAULT_USER_ID: 'u-1',
      STORYBLOCKS_DEFAULT_PROJECT_ID: 'p-1',
      ...extraEnv,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 1;
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    const p = pending.get(msg.id);
    if (p) {
      pending.delete(msg.id);
      p(msg);
    }
  });
  const request = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  const notify = (method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  const call = async (name, args) => {
    const msg = await request('tools/call', { name, arguments: args });
    if (msg.error) return { rpcError: msg.error };
    const r = msg.result;
    return { isError: !!r.isError, text: r.content[0].text, json: safeJson(r.content[0].text) };
  };
  return { child, request, notify, call, close: () => child.stdin.end() };
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

    // batch details: POST body + query
    r = await s.call('get_stock_items_details_batch', { media_type: 'images', stock_item_ids: [1, 2, 'abc'], results_per_page: 50 });
    assert.equal(r.isError, false);
    last = seen.at(-1);
    assert.equal(last.method, 'POST');
    assert.equal(last.path, '/api/v2/images/stock-item/details');
    assert.deepEqual(JSON.parse(last.body), { stockItemIds: [1, 2, 'abc'] });
    assert.equal(last.query.results_per_page, '50');

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
    r = await s.call('find_similar_stock_items', { media_type: 'images', stock_item_id: 5, limit: 20, extended: ['colors'] });
    assert.equal(r.isError, false);
    assert.equal(seen.at(-1).query.limit, '20');
    r = await s.call('get_collection_items', { media_type: 'audio', collection_id: 51392, page: 2 });
    assert.equal(r.isError, false);
    assert.equal(seen.at(-1).path, '/api/v2/audio/collections/51392');
    for (const [name, args] of [
      ['list_expiring_content', { media_type: 'videos' }],
      ['list_categories', { media_type: 'audio' }],
      ['list_collections', { media_type: 'images' }],
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

test('search requires attribution when no defaults are configured; other tools do not', async () => {
  const s = startServer({ STORYBLOCKS_DEFAULT_USER_ID: '', STORYBLOCKS_DEFAULT_PROJECT_ID: '' });
  try {
    await s.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    let r = await s.call('search_videos', { keywords: 'x' });
    assert.equal(r.isError, true);
    assert.match(r.text, /user_id/);
    r = await s.call('list_categories', { media_type: 'videos' });
    assert.equal(r.isError, false);
    assert.equal(seen.at(-1).query.user_id, undefined);
  } finally {
    s.close();
  }
});
