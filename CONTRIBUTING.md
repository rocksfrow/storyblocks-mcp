# Contributing

Thanks for your interest in improving the Storyblocks MCP server!

## Project layout

```
manifest.json          # MCPB manifest (tools, runtime, user_config)
server.json            # MCP Registry metadata (version/URL/SHA filled by CI)
server/
  index.js             # MCP stdio server: JSON-RPC loop, tools/*, resources/*
  tools.js             # Tool definitions (JSON Schema) and handlers
  schemas.js           # Shared schema fragments for every Storyblocks filter/enum
  validate.js          # Minimal JSON Schema validator for tool arguments
  storyblocks.js       # Signed HTTP client for api.storyblocks.com
  auth.js              # HMAC-SHA256 request signing
  config.js            # Environment variable loading
  docs.js              # Condensed API reference exposed as an MCP resource
test/                  # node:test suites (no test framework needed)
.github/workflows/     # CI (check/test/pack) and release (pack .mcpb, publish)
```

The runtime has **zero dependencies** — only Node.js built-ins (`crypto`,
`readline`, global `fetch`). There is no build step and no lockfile. Please keep
it that way unless there's a strong reason, and never add anything that opens
network listeners or reads files outside the project.

## Local development

Requires Node 20+.

```bash
cp .env.example .env        # fill in your Storyblocks keys
node --check server/*.js
npm test
```

Run against your real keys:

```bash
set -a; source .env; set +a
node server/index.js        # speaks JSON-RPC on stdin/stdout
npm run inspect             # or open the MCP Inspector against it
```

Smoke-test the protocol over stdio (no real keys needed for `initialize` / `tools/list`):

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  | STORYBLOCKS_PUBLIC_KEY=x STORYBLOCKS_PRIVATE_KEY=y node server/index.js
```

## Building the bundle

```bash
npm run mcpb:validate
npm run mcpb:pack           # -> storyblocks.mcpb
```

## Releasing

1. Bump `version` in `package.json`, `manifest.json`, and `server.json`.
2. Commit, then tag and push:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

CI verifies the tag matches `package.json`, runs the checks, validates the
manifest, packs the `.mcpb`, attaches it to a GitHub Release, and publishes to
the MCP Registry (SHA-256 computed in CI; GitHub OIDC auth, no secrets).

## Guidelines

- Never commit API keys or `.env` files. `.env.example` uses placeholders only.
- Keep tool names and descriptions clear and accurate — they are what the model reads.
- Keep `server/schemas.js` in sync with the [Storyblocks API reference](https://documentation.storyblocks.com/).
- When you add or rename a tool, update the `tools` list in `manifest.json` (CI checks they match) and the README.
- Open an issue before large changes.
