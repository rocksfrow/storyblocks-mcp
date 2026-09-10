#!/usr/bin/env node
'use strict';

/*
 * Storyblocks MCP server (stdio transport).
 *
 * Dependency-free MCP over newline-delimited JSON-RPC 2.0. Exposes the
 * Storyblocks API v2 (videos, audio, images) behind bring-your-own API keys;
 * every request is HMAC-signed locally and the private key never leaves the process.
 */

const readline = require('readline');
const { loadConfig } = require('./config');
const { StoryblocksClient } = require('./storyblocks');
const { TOOLS, callTool, describeError } = require('./tools');
const { validate } = require('./validate');
const { API_OVERVIEW } = require('./docs');

const SERVER_NAME = 'storyblocks-mcp';
const SERVER_VERSION = require('../package.json').version;
const PROTOCOL_VERSION = '2025-06-18';
const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const INSTRUCTIONS =
  'Tools for the Storyblocks stock media API (videos, audio, images). ' +
  'Start with search_* to find items, get_stock_item_details for full metadata, and get_download_links for licensed files. ' +
  'Search and download require user_id and project_id; supply them or rely on the configured defaults. ' +
  'Read the storyblocks://docs/api-overview resource for a condensed API reference.';

const RESOURCES = [
  {
    uri: 'storyblocks://docs/api-overview',
    name: 'api-overview',
    title: 'Storyblocks API overview',
    description: 'Condensed reference for Storyblocks API v2: auth, endpoints, parameters, and response shapes.',
    mimeType: 'text/markdown',
  },
];

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

let client;
try {
  client = new StoryblocksClient(loadConfig());
} catch (e) {
  process.stderr.write(`[storyblocks-mcp] ${e.message}\n`);
  process.exit(1);
}

// --- JSON-RPC plumbing ---

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}
function sendResult(id, result) {
  send({ jsonrpc: '2.0', id, result });
}
function sendError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  send({ jsonrpc: '2.0', id, error });
}

function textResult(value, isError = false) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const result = { content: [{ type: 'text', text }] };
  if (isError) result.isError = true;
  return result;
}

async function handleToolsCall(id, params) {
  const name = params && params.name;
  const tool = TOOLS_BY_NAME.get(name);
  if (!tool) {
    sendError(id, -32602, `Unknown tool: ${name}`);
    return;
  }
  const args = (params && params.arguments) || {};
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    sendError(id, -32602, 'Tool arguments must be an object');
    return;
  }
  const problems = validate(tool.inputSchema, args);
  if (problems.length) {
    sendError(id, -32602, `Invalid arguments for ${name}`, { errors: problems });
    return;
  }
  try {
    const value = await callTool(client, name, args);
    sendResult(id, textResult(value === null ? { status: 'ok' } : value));
  } catch (e) {
    sendResult(id, textResult(describeError(e), true));
  }
}

async function handleMessage(msg) {
  if (!msg || msg.jsonrpc !== '2.0') return;
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;
  try {
    switch (method) {
      case 'initialize': {
        const requested = params && params.protocolVersion;
        sendResult(id, {
          protocolVersion: SUPPORTED_PROTOCOLS.includes(requested) ? requested : PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
          instructions: INSTRUCTIONS,
        });
        return;
      }
      case 'notifications/initialized':
      case 'initialized':
      case 'notifications/cancelled':
      case 'notifications/roots/list_changed':
        return;
      case 'ping':
        if (isRequest) sendResult(id, {});
        return;
      case 'tools/list':
        sendResult(id, { tools: TOOLS });
        return;
      case 'tools/call':
        await handleToolsCall(id, params);
        return;
      case 'resources/list':
        sendResult(id, { resources: RESOURCES });
        return;
      case 'resources/templates/list':
        sendResult(id, { resourceTemplates: [] });
        return;
      case 'resources/read': {
        const uri = params && params.uri;
        const res = RESOURCES.find((r) => r.uri === uri);
        if (!res) {
          sendError(id, -32002, `Resource not found: ${uri}`);
          return;
        }
        sendResult(id, { contents: [{ uri: res.uri, mimeType: res.mimeType, text: API_OVERVIEW }] });
        return;
      }
      case 'prompts/list':
        sendResult(id, { prompts: [] });
        return;
      default:
        if (isRequest) sendError(id, -32601, `Method not found: ${method}`);
        return;
    }
  } catch (e) {
    if (isRequest) sendError(id, -32603, `Internal error: ${e.message}`);
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch (_) {
    sendError(null, -32700, 'Parse error');
    return;
  }
  if (Array.isArray(msg)) msg.forEach(handleMessage);
  else handleMessage(msg);
});
rl.on('close', () => process.exit(0));

// stdout is reserved for the protocol; log to stderr only.
process.stderr.write(`[storyblocks-mcp] v${SERVER_VERSION} ready (${client.config.baseUrl})\n`);
