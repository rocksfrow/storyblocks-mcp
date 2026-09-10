# Storyblocks MCP

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Built with MCPB](https://img.shields.io/badge/built%20with-MCPB-7C3AED.svg)](https://github.com/anthropics/mcpb)
[![Node](https://img.shields.io/badge/node-%3E%3D20-339933.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/dependencies-0-success.svg)](#why-zero-dependencies)
[![CI](https://github.com/rocksfrow/storyblocks-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/rocksfrow/storyblocks-mcp/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server for the **[Storyblocks API v2](https://documentation.storyblocks.com/)** — search stock footage, music, sound effects, photos, and vectors, pull item metadata, and fetch licensed download links from Claude, Cursor, or any MCP client.

This is a **bring-your-own-credentials** tool: you supply the API keys Storyblocks issued to you, and the server signs each request locally with Storyblocks' HMAC scheme. Nothing is hosted, your private key never leaves your machine, and there is **nothing to install** — the server is plain Node.js with zero dependencies.

> **Unofficial.** This is an independent, community-built project. It is not affiliated with, endorsed by, or supported by Storyblocks. Your use of the API is governed by your own agreement with Storyblocks.

## What you get

- `search_videos` / `search_audio` / `search_images` — every filter the API supports (content type, duration, BPM, orientation, color, releases, editorial, frame rate, VR, sort, pagination, extended fields)
- `get_stock_item_details` / `get_stock_items_details_batch` — full metadata and available download formats
- `get_download_links` — full-quality, licensed download URLs by format
- `find_similar_stock_items` — "more like this"
- `list_categories` / `list_collections` / `get_collection_items` — browse curated content
- `list_expiring_content` — removed items still downloadable for a limited time
- `whitelist_youtube_channel` / `file_youtube_audio_dispute` / `list_valid_claimants` — YouTube Content ID claim tooling for Storyblocks audio
- `storyblocks_raw_request` — signed escape hatch for any `/api/v2` path
- Resource `storyblocks://docs/api-overview` — a condensed API reference the model can read

## Prerequisites: Storyblocks API keys

You need a **public key** and a **private key** from Storyblocks.

- Free **test keys** (lower rate limits, internal testing only): <https://developer.storyblocks.com/register>
- **Full-access keys**: <https://www.storyblocks.com/business-solution/api> or `enterprise@storyblocks.com`

Storyblocks also requires a `user_id` and `project_id` on every search and download. These are opaque identifiers from *your* system (not names or emails) that let Storyblocks tie downloads to searches and pay contributors. You can set defaults once (below) or pass them per call.

## Install in Claude Desktop (the `.mcpb`)

1. Download `storyblocks.mcpb` from the [latest release](https://github.com/rocksfrow/storyblocks-mcp/releases/latest).
2. **Settings → Extensions → Install extension**, pick the file.
3. When prompted, paste your **public key** and **private key**. Leave the optional *user id* / *project id* fields blank — see [User and project ids](#user-and-project-ids).

## Use with other MCP clients (Cursor, VS Code, Windsurf, …)

Underneath this is a standard **stdio MCP server** — any client that runs local MCP servers can use it directly, no `.mcpb` required. Clone or download the repo (no `npm install`, no build step) and point the client at `server/index.js`.

```bash
git clone https://github.com/rocksfrow/storyblocks-mcp.git
```

**Cursor** — `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per project):

```json
{
  "mcpServers": {
    "storyblocks": {
      "command": "node",
      "args": ["/absolute/path/to/storyblocks-mcp/server/index.js"],
      "env": {
        "STORYBLOCKS_PUBLIC_KEY": "…",
        "STORYBLOCKS_PRIVATE_KEY": "…"
      }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`), **Windsurf**, and **Claude Desktop** (manual config) use the same `command` + `args` + `env` shape; only the file location differs.

> **Remote-only clients** (ChatGPT connectors, Perplexity, …) need an HTTPS MCP URL and can't run a local command, so this stdio build can't be added to them directly.

## Usage examples

- "Find 4K drone footage of a coastline, under 30 seconds" → `search_videos { keywords: "coastline aerial", quality: "4K", max_duration: 30 }`
- "Upbeat instrumental around 120 BPM for a product video" → `search_audio { keywords: "upbeat corporate", content_type: ["music"], min_bpm: 110, max_bpm: 130, has_vocals: false }`
- "Landscape photos of Tokyo at night with a lot of blue" → `search_images { keywords: "tokyo night", orientation: "landscape", color: "#1E3A8A" }`
- "What formats is item 11851 available in?" → `get_stock_item_details { media_type: "videos", stock_item_id: 11851 }`
- "Give me the download link for that clip" → `get_download_links { media_type: "videos", stock_item_id: 11851 }`
- "Show me more like this track" → `find_similar_stock_items { media_type: "audio", stock_item_id: 148396, limit: 10 }`

Search responses are capped at 10,000 results by Storyblocks (`results_per_page` ≤ 250). Category ids from `list_categories` can be passed to the `categories` filter along with the matching `content_type`.

Things worth knowing:

- **`get_download_links` is a licensed download.** It counts against your account's download limit, so it should be called once the user has picked an item, not while browsing. The URLs it returns are CloudFront-signed and expire roughly 30 minutes after issue — download immediately and don't store them. Preview and thumbnail URLs from search are public and safe to keep.
- **Image `content_type`:** over 99% of the image library (ordinary photos included) is typed `snapshots`, so filtering to `photos` returns almost nothing. Leave it unset unless you want illustrations or vectors.
- **Entitlements:** `find_similar_stock_items` and `list_expiring_content` are not enabled on every key. A `403 "API function request is invalid."` means the endpoint isn't switched on for your account (your credentials are fine); ask Storyblocks to enable it.
- **`list_collections`** is paged client-side (50 per page, `search` filter) because Storyblocks returns the entire list — hundreds of entries — in one response. **`get_stock_items_details_batch`** fetches and merges all upstream pages by default so `invalid_stock_ids` / `stock_ids_not_found` are always complete (Storyblocks only reports them on the final page).

## User and project ids

Storyblocks requires a `user_id` and `project_id` on every search and download. They are identifiers in **your** system — Storyblocks does not issue them and its dashboard never shows them — and they exist so Storyblocks can tie downloads to searches, replay support cases, and de-duplicate repeat downloads by the same person when paying contributors. Because of that last point, `user_id` must be stable over time and must not be a name or email (the raw value is transmitted; Storyblocks hashes it on their side).

For a personal install there is nothing to configure. The server uses:

| | Default | Where it comes from |
| --- | --- | --- |
| `project_id` | `storyblocks-mcp` | fixed slug identifying this integration |
| `user_id` | `mcp-` + 16 random hex chars | generated once with `crypto.randomBytes` and saved to `~/.storyblocks-mcp/user-id`, so it is stable across restarts and distinct per install |

If you embed this server in a multi-user application that already has user and project ids, set `STORYBLOCKS_DEFAULT_USER_ID` / `STORYBLOCKS_DEFAULT_PROJECT_ID` or pass `user_id` / `project_id` on each call. Both must match `^[A-Za-z0-9_-]+$` — the server rejects anything else at startup (env) or before the request is sent (tool args). It never derives ids from your hostname, OS username, or email. `STORYBLOCKS_STATE_DIR` moves the state file.

## How authentication works

Every request carries three query parameters: `APIKEY` (your public key), `EXPIRES` (a unix timestamp, at most 36 hours ahead), and `HMAC` = hex(HMAC-SHA256(key = `privateKey + EXPIRES`, data = URL path)). The signed data is the path only — no host, no query string — but it includes path parameters such as the stock item id. The server computes this per request in `server/auth.js`; the private key is used only as HMAC input and is never sent or logged.

Storyblocks rate-limits per endpoint and per client; test keys have lower limits than full-access keys. `get_download_links` is a licensed download event and counts against the download limit.

## Configuration (env overrides)

| Variable | Purpose | Default |
| --- | --- | --- |
| `STORYBLOCKS_PUBLIC_KEY` | Public key, sent as `APIKEY` (required) | — |
| `STORYBLOCKS_PRIVATE_KEY` | Secret key, used to compute `HMAC` (required) | — |
| `STORYBLOCKS_DEFAULT_USER_ID` | Fallback `user_id` for search/download (`[A-Za-z0-9_-]+`) | generated per install, see above |
| `STORYBLOCKS_DEFAULT_PROJECT_ID` | Fallback `project_id` for search/download (`[A-Za-z0-9_-]+`) | `storyblocks-mcp` |
| `STORYBLOCKS_STATE_DIR` | Where the generated `user-id` file lives | `~/.storyblocks-mcp` |
| `STORYBLOCKS_BASE_URL` | API host | `https://api.storyblocks.com` |
| `STORYBLOCKS_EXPIRES_SECONDS` | Signed-request lifetime (max 129600) | `300` |
| `STORYBLOCKS_TIMEOUT_MS` | Per-request timeout | `30000` |

Blank values — and the unreplaced `${user_config.…}` placeholders Claude Desktop passes through when an optional field is left empty — are treated as unset.

## Errors

API errors (400 bad parameter, 403, 404 not found, 429 rate limit) are returned as tool errors containing the HTTP status, the `errors` message from Storyblocks, and a troubleshooting hint tailored to the response. A 403 with `"APIKEY header is invalid"` means a wrong key or skewed system clock; a 403 with `"API function request is invalid."` means the endpoint isn't enabled for your key.

## Build

```bash
npm test               # node:test — HMAC vs. openssl, schema validation, full stdio protocol run against a mock API
npm run mcpb:validate  # validate manifest.json
npm run mcpb:pack      # pack storyblocks.mcpb
```

Pushing a `vX.Y.Z` tag triggers CI to run the checks, pack the bundle, attach it to a GitHub Release, and publish to the MCP Registry.

## Why zero dependencies

Only Node.js built-ins (`crypto`, `fs`, `readline`, global `fetch`) — no `node_modules`, no lockfile, no build step. The whole server is a few hundred lines you can read in one sitting, the `.mcpb` is ~25 KB, and there is no third-party code between your API keys and the wire. The MCP protocol itself is small enough (JSON-RPC over stdio: `initialize`, `tools/list`, `tools/call`, `resources/*`) that hand-rolling it in `server/index.js` is simpler than depending on an SDK.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT © Kyle Renfrow

---

*Not affiliated with or endorsed by Storyblocks. "Storyblocks" is a trademark of Footage Firm, Inc. Use of the Storyblocks API is subject to your own API agreement with Storyblocks.*
