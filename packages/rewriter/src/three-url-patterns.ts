import type { AssetRecord, AssetRole } from "@clone3d/shared";
import { getExtension } from "@clone3d/shared";

export const THREE_D_EXTENSIONS = new Set([
  ".gltf",
  ".glb",
  ".bin",
  ".drc",
  ".ktx2",
  ".basis",
  ".wasm",
  ".hdr",
  ".exr"
]);

export const TEXTURE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".avif",
  ".ktx2",
  ".basis",
  ".hdr",
  ".exr"
]);

export const WORKER_SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);

export const THREE_D_REFERENCE_EXTENSIONS = new Set([
  ...THREE_D_EXTENSIONS,
  ...TEXTURE_EXTENSIONS,
  ".js",
  ".mjs",
  ".json"
]);

const DRACO_RE = /(?:draco|dracoloader|draco_decoder|draco_wasm_wrapper|draco_decoder_gltf)/i;
const BASIS_RE = /(?:basis|basis_transcoder|ktx2loader|basistextureloader|transcoder)/i;
const MESHOPT_RE = /(?:meshopt|meshopt_decoder|ext_meshopt_compression)/i;
const WORKER_RE = /(?:worker|\.worker\.(?:js|mjs)$)/i;

export function getAssetExtension(asset: AssetRecord): string | undefined {
  return (
    normalizeExtension(asset.detectedExtension) ??
    getExtension(asset.normalizedUrl) ??
    getExtension(asset.originalUrl)
  );
}

export function getAssetFilename(asset: AssetRecord): string {
  return getFilename(asset.normalizedUrl) || getFilename(asset.originalUrl) || asset.normalizedUrl || asset.originalUrl;
}

export function isDecoderLike(value: string): boolean {
  return DRACO_RE.test(value) || BASIS_RE.test(value) || MESHOPT_RE.test(value);
}

export function isWorkerLike(asset: AssetRecord): boolean {
  const filename = getAssetFilename(asset);
  return asset.source.includes("worker-hook") || WORKER_RE.test(filename);
}

export function roleFromDecoderName(value: string, extension: string | undefined): AssetRole | undefined {
  if (DRACO_RE.test(value)) {
    return extension === ".wasm" ? "wasm" : "draco-decoder";
  }

  if (BASIS_RE.test(value)) {
    return extension === ".wasm" ? "wasm" : "basis-transcoder";
  }

  if (MESHOPT_RE.test(value)) {
    return extension === ".wasm" ? "wasm" : "meshopt-decoder";
  }

  return undefined;
}

export function looksLike3dReference(value: string): boolean {
  const extension = getExtension(value);
  return Boolean(
    extension &&
      (THREE_D_REFERENCE_EXTENSIONS.has(extension) ||
        /\.worker\.(?:js|mjs)(?:[?#].*)?$/i.test(value) ||
        isDecoderLike(value))
  );
}

function normalizeExtension(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return value.startsWith(".") ? value.toLowerCase() : `.${value.toLowerCase()}`;
}

function getFilename(value: string): string | undefined {
  try {
    const pathname = new URL(value).pathname;
    return pathname.split("/").filter(Boolean).at(-1);
  } catch {
    const cleaned = value.split(/[?#]/)[0] ?? "";
    return cleaned.split("/").filter(Boolean).at(-1);
  }
}
