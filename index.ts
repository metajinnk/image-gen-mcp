/**
 * image-gen-mcp
 * Cloudflare Worker — MCP server for AI image generation
 * Supports: Google Imagen 4 (via Gemini API), DALL-E 3 (OpenAI)
 * Storage: Cloudflare R2
 */

export interface Env {
  IMAGES: R2Bucket;
  PUBLIC_URL: string;
  AUTH_TOKEN?: string;
  GOOGLE_API_KEY_WORK?: string;
  GOOGLE_API_KEY?: string;
  OPENAI_API_KEY?: string;
}

// ─── Tool definitions (MCP protocol) ───────────────────────────────────────

const TOOLS = [
  {
    name: "create_visual",
    description: [
      "Generate an image with AI and store it permanently in cloud (R2).",
      "Returns: (1) a permanent URL the user can download/embed anywhere,",
      "         (2) a 200px JPEG thumbnail as an image block so Claude can see the result.",
      "Engines: openai = DALL-E 3, google = Imagen 4, auto = keyword-based selection.",
      "After generation Claude should describe what it sees and ask if changes are needed.",
    ].join(" "),
    inputSchema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description: "Image prompt. English recommended for best quality.",
        },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "16:9", "9:16"],
          default: "1:1",
          description: "1:1 square | 16:9 landscape | 9:16 portrait",
        },
        engine: {
          type: "string",
          enum: ["google-work", "google", "openai"],
          default: "google-work",
          description:
            "google-work = work API (default), google = personal API, openai = DALL-E",
        },
        filename: {
          type: "string",
          description: "Storage filename without extension. Auto-generated if omitted.",
        },
        style: {
          type: "string",
          enum: ["vivid", "natural", "auto"],
          default: "auto",
          description: "OpenAI only. vivid=dramatic, natural=realistic",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "list_visuals",
    description: "List all images stored in cloud. Returns filenames, URLs, metadata.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", default: 20, description: "Max results (1-100)" },
      },
    },
  },
  {
    name: "get_visual_snippet",
    description:
      "Get embeddable code snippet (HTML, CSS, Markdown, or URL) for a stored image.",
    inputSchema: {
      type: "object",
      properties: {
        filename: {
          type: "string",
          description: "Image filename (with or without .png extension)",
        },
        snippet_type: {
          type: "string",
          enum: ["html_img", "css_bg", "markdown", "url"],
          default: "html_img",
        },
      },
      required: ["filename"],
    },
  },
];

// ─── Engine selection ───────────────────────────────────────────────────────

function selectEngine(
  _prompt: string,
  requested: string
): "google-work" | "google" | "openai" {
  if (requested === "openai") return "openai";
  if (requested === "google") return "google";
  return "google-work";
}

// ─── Image generation ───────────────────────────────────────────────────────

async function generateOpenAI(
  prompt: string,
  aspectRatio: string,
  style: string,
  apiKey: string
): Promise<ArrayBuffer> {
  const sizeMap: Record<string, string> = {
    "1:1": "1024x1024",
    "16:9": "1792x1024",
    "9:16": "1024x1792",
  };
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "dall-e-3",
      prompt,
      n: 1,
      size: sizeMap[aspectRatio] || "1024x1024",
      style: style === "auto" ? "vivid" : style,
      response_format: "b64_json",
    }),
  });
  if (!res.ok) {
    const err: any = await res.json();
    throw new Error(`OpenAI: ${err.error?.message || res.statusText}`);
  }
  const data: any = await res.json();
  return base64ToBuffer(data.data[0].b64_json);
}

async function generateGoogle(
  prompt: string,
  aspectRatio: string,
  apiKey: string,
  model = "imagen-4.0-generate-001"
): Promise<ArrayBuffer> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        instances: [{ prompt }],
        parameters: { sampleCount: 1, aspectRatio },
      }),
    }
  );
  if (!res.ok) {
    const err: any = await res.json();
    throw new Error(`Google Imagen: ${err.error?.message || res.statusText}`);
  }
  const data: any = await res.json();
  return base64ToBuffer(data.predictions[0].bytesBase64Encoded);
}

function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function normalizeFilename(name: string): string {
  return name.endsWith(".png") ? name : `${name}.png`;
}

// ─── Tool handlers ──────────────────────────────────────────────────────────

async function toolCreateVisual(args: any, env: Env) {
  const prompt = String(args.prompt || "").trim();
  if (!prompt) throw new Error("prompt is required");

  const aspectRatio = String(args.aspect_ratio || "1:1");
  const style = String(args.style || "auto");
  const engine = selectEngine(prompt, String(args.engine || "google-work"));
  const timestamp = Date.now();
  const fileBase = String(args.filename || `img_${timestamp}`).replace(/\.[^.]+$/, "");
  const filename = `${fileBase}.png`;

  let imageBuffer: ArrayBuffer;

  if (engine === "google-work") {
    if (!env.GOOGLE_API_KEY_WORK) throw new Error("GOOGLE_API_KEY_WORK not configured");
    imageBuffer = await generateGoogle(
      prompt,
      aspectRatio,
      env.GOOGLE_API_KEY_WORK,
      "imagen-4.0-ultra-001"
    );
  } else if (engine === "google") {
    if (!env.GOOGLE_API_KEY) throw new Error("GOOGLE_API_KEY not configured");
    imageBuffer = await generateGoogle(
      prompt,
      aspectRatio,
      env.GOOGLE_API_KEY,
      "imagen-4.0-generate-001"
    );
  } else {
    if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY not configured");
    imageBuffer = await generateOpenAI(prompt, aspectRatio, style, env.OPENAI_API_KEY);
  }

  await env.IMAGES.put(filename, imageBuffer, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: {
      prompt: prompt.slice(0, 500),
      engine,
      aspectRatio,
      created: new Date(timestamp).toISOString(),
    },
  });

  const imageUrl = `${env.PUBLIC_URL}/i/${encodeURIComponent(filename)}`;
  const meta = {
    url: imageUrl,
    filename,
    engine,
    aspect_ratio: aspectRatio,
    created_at: new Date(timestamp).toISOString(),
    prompt_preview: prompt.slice(0, 100) + (prompt.length > 100 ? "…" : ""),
  };

  return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }] };
}

async function toolListVisuals(args: any, env: Env) {
  const limit = Math.min(100, Math.max(1, Number(args.limit || 20)));
  const listed = await env.IMAGES.list({ limit });
  const images = listed.objects.map((obj: any) => ({
    filename: obj.key,
    url: `${env.PUBLIC_URL}/i/${encodeURIComponent(obj.key)}`,
    size_kb: Math.round(obj.size / 1024),
    created_at: obj.customMetadata?.created || obj.uploaded?.toISOString(),
    engine: obj.customMetadata?.engine,
    prompt: obj.customMetadata?.prompt,
  }));
  return {
    content: [{ type: "text", text: JSON.stringify({ count: images.length, images }, null, 2) }],
  };
}

async function toolGetVisualSnippet(args: any, env: Env) {
  const filename = normalizeFilename(String(args.filename || ""));
  const snippetType = String(args.snippet_type || "html_img");
  const url = `${env.PUBLIC_URL}/i/${encodeURIComponent(filename)}`;
  const snippets: Record<string, string> = {
    html_img: `<img src="${url}" alt="${filename}" style="max-width:100%;display:block;">`,
    css_bg: `background-image: url('${url}'); background-size: cover;`,
    markdown: `![${filename}](${url})`,
    url,
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          { filename, url, snippet_type: snippetType, snippet: snippets[snippetType] || url },
          null,
          2
        ),
      },
    ],
  };
}

// ─── MCP protocol handler ───────────────────────────────────────────────────

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

function sseResponse(id: unknown, result: unknown): Response {
  return new Response(`data: ${JSON.stringify({ jsonrpc: "2.0", id, result })}\n\n`, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
    },
  });
}

async function handleMCP(request: Request, env: Env): Promise<Response> {
  const acceptSSE = (request.headers.get("Accept") || "").includes("text/event-stream");

  if (env.AUTH_TOKEN) {
    const auth = request.headers.get("Authorization") || "";
    if (auth !== `Bearer ${env.AUTH_TOKEN}`) {
      return jsonResponse(
        { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } },
        401
      );
    }
  }

  const body: any = await request.json();
  const { method, id, params } = body;

  try {
    let result: unknown;
    switch (method) {
      case "initialize":
        result = {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "image-gen-mcp", version: "2.0.0" },
        };
        break;
      case "notifications/initialized":
        return new Response(null, { status: 204 });
      case "ping":
        result = {};
        break;
      case "tools/list":
        result = { tools: TOOLS };
        break;
      case "tools/call": {
        const p = params as any;
        switch (p?.name) {
          case "create_visual":
            result = await toolCreateVisual(p?.arguments || {}, env);
            break;
          case "list_visuals":
            result = await toolListVisuals(p?.arguments || {}, env);
            break;
          case "get_visual_snippet":
            result = await toolGetVisualSnippet(p?.arguments || {}, env);
            break;
          default:
            throw new Error(`Unknown tool: ${p?.name}`);
        }
        break;
      }
      default:
        return jsonResponse({
          jsonrpc: "2.0",
          id,
          error: { code: -32601, message: `Method not found: ${method}` },
        });
    }
    return acceptSSE ? sseResponse(id, result) : jsonResponse({ jsonrpc: "2.0", id, result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal error";
    return jsonResponse({ jsonrpc: "2.0", id, error: { code: -32000, message } });
  }
}

async function serveImage(key: string, env: Env): Promise<Response> {
  const obj = await env.IMAGES.get(key);
  if (!obj) return new Response("Image not found", { status: 404 });
  return new Response(obj.body, {
    headers: {
      "Content-Type": obj.httpMetadata?.contentType || "image/png",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// ─── CORS & OAuth stubs (for MCP client compatibility) ─────────────────────

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept",
};

// ─── Main fetch handler ─────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const { pathname } = url;

    // OAuth discovery endpoints (required by some MCP clients)
    if (
      request.method === "GET" &&
      (pathname === "/.well-known/oauth-protected-resource" ||
        pathname === "/.well-known/oauth-protected-resource/mcp")
    ) {
      return jsonResponse({
        resource: env.PUBLIC_URL,
        authorization_servers: [env.PUBLIC_URL],
      });
    }

    if (request.method === "GET" && pathname === "/.well-known/oauth-authorization-server") {
      return jsonResponse({
        issuer: env.PUBLIC_URL,
        authorization_endpoint: `${env.PUBLIC_URL}/authorize`,
        token_endpoint: `${env.PUBLIC_URL}/token`,
        registration_endpoint: `${env.PUBLIC_URL}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code"],
        code_challenge_methods_supported: ["S256"],
      });
    }

    if (request.method === "GET" && pathname === "/authorize") {
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      const state = url.searchParams.get("state") || "";
      const code = crypto.randomUUID().replace(/-/g, "");
      const dest = new URL(redirectUri);
      dest.searchParams.set("code", code);
      if (state) dest.searchParams.set("state", state);
      return Response.redirect(dest.toString(), 302);
    }

    if (request.method === "POST" && pathname === "/token") {
      return jsonResponse({
        access_token: crypto.randomUUID(),
        token_type: "bearer",
        expires_in: 86400,
      });
    }

    if (request.method === "POST" && pathname === "/register") {
      const body = await request.json().catch(() => ({}));
      return new Response(
        JSON.stringify({
          client_id: crypto.randomUUID(),
          client_secret: crypto.randomUUID(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
          client_secret_expires_at: 0,
          ...(body as object),
        }),
        { status: 201, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }
      );
    }

    // MCP endpoint
    if (request.method === "POST" && pathname === "/mcp") {
      return handleMCP(request, env);
    }

    // Image serving
    if (request.method === "GET" && pathname.startsWith("/i/")) {
      const key = decodeURIComponent(pathname.slice(3));
      return serveImage(key, env);
    }

    // Health check
    if (pathname === "/" || pathname === "/health") {
      return jsonResponse({ status: "ok", server: "image-gen-mcp", version: "2.0.0" });
    }

    return new Response("Not found", { status: 404 });
  },
};
