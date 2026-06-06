const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".bin": "application/octet-stream",
  ".drc": "application/octet-stream",
  ".ktx2": "image/ktx2",
  ".basis": "application/octet-stream",
  ".wasm": "application/wasm",
  ".hdr": "application/octet-stream",
  ".exr": "image/aces",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".ogg": "audio/ogg",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm"
};

export function inferContentType(urlOrPath: string, fallback = "application/octet-stream"): string {
  const extension = getExtension(urlOrPath);
  return extension ? MIME_BY_EXT[extension] ?? fallback : fallback;
}

export function getExtension(urlOrPath: string): string | undefined {
  try {
    const pathname = new URL(urlOrPath).pathname;
    return extensionFromPath(pathname);
  } catch {
    return extensionFromPath(urlOrPath);
  }
}

function extensionFromPath(pathname: string): string | undefined {
  const match = pathname.match(/\.([a-z0-9]+)$/i);
  return match ? `.${match[1].toLowerCase()}` : undefined;
}
