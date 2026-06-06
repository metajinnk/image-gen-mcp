# image-gen-mcp

> A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server, running on **Cloudflare Workers**, that lets AI assistants (Claude, etc.) generate images and store them permanently in the cloud.

![MCP](https://img.shields.io/badge/MCP-2024--11--05-blue)
![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

When an AI client connects, it gains three tools: generate an image (Google Imagen 4 or DALL-E 3), list everything it has generated, and get a ready-to-paste embed snippet. Generated images are written to **Cloudflare R2** and served from a permanent, CDN-cached public URL — so they can be embedded in chats, documents, or web pages and never expire.

The whole server is a single edge Worker with **no cold starts, no servers to run, and no database** — R2 object metadata is the store. It runs globally on Cloudflare's network and scales to zero cost when idle.

## Features

- 🎨 **Google Imagen 4** — Ultra and standard, via the Gemini API
- 🖼️ **DALL-E 3** — via the OpenAI API
- ☁️ **Cloudflare R2** permanent storage — images never expire
- 🔗 Public, immutable, CDN-cached URLs for embedding anywhere
- 📐 Aspect ratios: `1:1` (square), `16:9` (landscape), `9:16` (portrait)
- 🔐 Optional Bearer-token auth, with OAuth discovery stubs for MCP clients that require them
- ⚡ Streamable HTTP transport (JSON or SSE), zero infrastructure to operate

## MCP Tools

| Tool | Description |
|---|---|
| `create_visual` | Generate an image with the chosen engine and store it in R2; returns a permanent URL + metadata |
| `list_visuals` | List stored images with filename, URL, size, engine, and original prompt |
| `get_visual_snippet` | Get an embed snippet for a stored image (`html_img`, `css_bg`, `markdown`, or `url`) |

### `create_visual` parameters

| Param | Type | Default | Notes |
|---|---|---|---|
| `prompt` | string | — | **Required.** English recommended for best quality |
| `engine` | enum | `google-work` | `google-work` = Imagen 4 Ultra · `google` = Imagen 4 standard · `openai` = DALL-E 3 |
| `aspect_ratio` | enum | `1:1` | `1:1` · `16:9` · `9:16` |
| `style` | enum | `auto` | OpenAI only — `vivid` (dramatic) · `natural` (realistic) |
| `filename` | string | auto | Storage name without extension; auto-generated if omitted |

## Setup

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com)
- The [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (`npm install -g wrangler`)
- A Google Gemini API key (for Imagen) and/or an OpenAI API key

### Deploy

```bash
# 1. Install dependencies
npm install

# 2. Create the R2 bucket (must match `bucket_name` in wrangler.toml)
wrangler r2 bucket create claude-images

# 3. Set the API keys you intend to use (at least one is required)
wrangler secret put GOOGLE_API_KEY_WORK   # Imagen 4 Ultra  (engine: google-work)
wrangler secret put GOOGLE_API_KEY        # Imagen 4 std    (engine: google)     — optional
wrangler secret put OPENAI_API_KEY        # DALL-E 3        (engine: openai)     — optional
wrangler secret put AUTH_TOKEN            # Bearer auth                          — optional

# 4. Deploy
wrangler deploy
```

After the first deploy, update `PUBLIC_URL` in [`wrangler.toml`](wrangler.toml) to your Worker's actual URL (shown by `wrangler deploy`) and redeploy. This value is used to build the public image links.

### Local development

```bash
cp .dev.vars.example .dev.vars   # if present; otherwise create .dev.vars
# add your keys to .dev.vars (this file is git-ignored)
wrangler dev
```

## Connecting an MCP client

The MCP endpoint is `POST https://<your-worker-url>/mcp`.

**Claude Desktop / claude.ai** — add a custom connector pointing at the `/mcp` URL.

**Config-file based clients** (e.g. Claude Code):

```json
{
  "mcpServers": {
    "image-gen": {
      "url": "https://image-gen-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

If you set `AUTH_TOKEN`, the client must send `Authorization: Bearer <token>`.

## HTTP endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/mcp` | MCP JSON-RPC endpoint (JSON or SSE response) |
| `GET` | `/i/<filename>` | Serve a stored image (immutable, 1-year CDN cache) |
| `GET` | `/` · `/health` | Health check |
| `GET`/`POST` | `/.well-known/oauth-*`, `/authorize`, `/token`, `/register` | OAuth discovery stubs for MCP-client compatibility |

## Architecture

```
AI client (Claude, …)
  └─ MCP over HTTP ─► Cloudflare Worker (this repo)
                       ├─► Google Generative Language API   (Imagen 4 Ultra / standard)
                       ├─► OpenAI API                        (DALL-E 3)
                       └─► Cloudflare R2                      (image storage + metadata)
                              └─ served back via GET /i/<filename>
```

There is no separate database: image metadata (prompt, engine, aspect ratio, timestamp) is stored as R2 custom metadata and read back by `list_visuals`.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | ✅ | Worker's public URL (set in `wrangler.toml`); used to build image links |
| `GOOGLE_API_KEY_WORK` | ✅\* | Gemini API key for Imagen 4 Ultra |
| `GOOGLE_API_KEY` | ✅\* | Gemini API key for Imagen 4 standard |
| `OPENAI_API_KEY` | ✅\* | OpenAI API key for DALL-E 3 |
| `AUTH_TOKEN` | ❌ | Bearer token for auth (leave unset = open access) |

\* At least one image API key is required; set whichever engines you want to use.

## License

[MIT](LICENSE)
