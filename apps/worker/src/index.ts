import { CLONE3D_VERSION } from "@clone3d/shared";

interface Env {
  readonly ENVIRONMENT?: string;
}

type WorkerHandler<TEnv> = {
  fetch(request: Request, env: TEnv, context: unknown): Response | Promise<Response>;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
  "Cross-Origin-Resource-Policy": "cross-origin"
};

const CACHE_HEADERS = {
  "Cache-Control": "public, max-age=31536000, immutable"
};

const worker: WorkerHandler<Env> = {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS" && url.pathname.startsWith("/catbox/")) {
      return new Response(null, {
        status: 204,
        headers: CORS_HEADERS
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        ok: true,
        service: "clone3d-snapshot-worker",
        version: CLONE3D_VERSION
      });
    }

    if ((request.method === "GET" || request.method === "HEAD") && url.pathname.startsWith("/catbox/")) {
      return proxyCatbox(request, url);
    }

    return json(
      {
        ok: false,
        error: "not_found"
      },
      404
    );
  }
};

async function proxyCatbox(request: Request, url: URL): Promise<Response> {
  const filename = decodeURIComponent(url.pathname.replace(/^\/catbox\/+/, ""));
  if (!/^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return json({ ok: false, error: "invalid_catbox_filename" }, 400, CORS_HEADERS);
  }

  const catboxUrl = `https://files.catbox.moe/${filename}`;
  const upstream = await fetch(catboxUrl, {
    method: request.method,
    headers: {
      "User-Agent": "Clone3D Snapshot CORS Proxy"
    }
  });
  const headers = new Headers(upstream.headers);
  headers.set("Content-Type", inferContentType(filename));
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    headers.set(key, value);
  }
  for (const [key, value] of Object.entries(CACHE_HEADERS)) {
    headers.set(key, value);
  }

  return new Response(request.method === "HEAD" ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers
  });
}

function json(body: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(body), {
    status,
    headers
  });
}

function inferContentType(filename: string): string {
  const extension = filename.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  switch (extension) {
    case "js":
    case "mjs":
      return "text/javascript; charset=utf-8";
    case "css":
      return "text/css; charset=utf-8";
    case "json":
      return "application/json; charset=utf-8";
    case "gltf":
      return "model/gltf+json";
    case "glb":
      return "model/gltf-binary";
    case "wasm":
      return "application/wasm";
    case "bin":
    case "drc":
    case "basis":
    case "hdr":
      return "application/octet-stream";
    case "ktx2":
      return "image/ktx2";
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "avif":
      return "image/avif";
    case "svg":
      return "image/svg+xml";
    case "ogg":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "exr":
      return "image/aces";
    default:
      return "application/octet-stream";
  }
}

export default worker;
