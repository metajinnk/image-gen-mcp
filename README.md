# image-gen-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server running on **Cloudflare Workers** that enables AI assistants (Claude, etc.) to generate and store images permanently via cloud APIs.

## Features

- 🎨 **Google Imagen 4** (Ultra & standard via Gemini API)
- 🖼️ **DALL-E 3** (OpenAI)
- ☁️ **Cloudflare R2** permanent storage — images never expire
- 🔗 Public URLs for embedding anywhere
- 📐 Aspect ratio support: `1:1`, `16:9`, `9:16`

## MCP Tools

| Tool | Description |
|---|---|
| `create_visual` | Generate an image and store it in R2 |
| `list_visuals` | List all stored images with metadata |
| `get_visual_snippet` | Get HTML/CSS/Markdown embed snippet for an image |

## Setup

### Prerequisites

- [Cloudflare account](https://dash.cloudflare.com)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/)
- Google Gemini API key (for Imagen) and/or OpenAI API key

### Deploy

```bash
npm install
wrangler r2 bucket create claude-images
wrangler secret put GOOGLE_API_KEY_WORK   # Imagen 4 Ultra
wrangler secret put GOOGLE_API_KEY        # Imagen 4 standard (optional)
wrangler secret put OPENAI_API_KEY        # DALL-E 3 (optional)
wrangler secret put AUTH_TOKEN            # Bearer token auth (optional)
wrangler deploy
```

### Connect to Claude

Add to your Claude MCP config:

```json
{
  "mcpServers": {
    "image-gen": {
      "url": "https://image-gen-mcp.<your-subdomain>.workers.dev/mcp"
    }
  }
}
```

## Architecture

```
Claude (MCP client)
  └─► Cloudflare Worker (this repo)
        ├─► Google Generative Language API  (Imagen 4)
        ├─► OpenAI API                      (DALL-E 3)
        └─► Cloudflare R2                   (image storage)
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PUBLIC_URL` | ✅ | Worker's public URL (set in `wrangler.toml`) |
| `GOOGLE_API_KEY_WORK` | ✅* | Gemini API key for Imagen 4 Ultra |
| `GOOGLE_API_KEY` | ✅* | Gemini API key for Imagen 4 standard |
| `OPENAI_API_KEY` | ✅* | OpenAI API key for DALL-E 3 |
| `AUTH_TOKEN` | ❌ | Bearer token for auth (leave unset = open) |

*At least one image API key required.

## License

MIT
