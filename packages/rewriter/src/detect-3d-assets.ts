import type { AssetRecord, AssetRole } from "@clone3d/shared";
import {
  getAssetExtension,
  getAssetFilename,
  isWorkerLike,
  roleFromDecoderName,
  TEXTURE_EXTENSIONS
} from "./three-url-patterns";

const MODEL_PATH_RE = /(?:model|models|scene|scenes|mesh|meshes|gltf|glb|three|babylon|assets?)/i;

export function detect3dAssetRole(asset: AssetRecord): AssetRole {
  const extension = getAssetExtension(asset);
  const filename = getAssetFilename(asset);
  const contentType = asset.contentType?.toLowerCase() ?? "";
  const joined = `${asset.originalUrl} ${asset.normalizedUrl} ${filename} ${contentType}`;

  if (extension === ".gltf" || contentType.includes("model/gltf+json")) {
    return "gltf";
  }

  if (extension === ".glb" || contentType.includes("model/gltf-binary")) {
    return "glb";
  }

  if (extension === ".drc") {
    return "draco-compressed";
  }

  if (extension === ".ktx2") {
    return "ktx2-texture";
  }

  const decoderRole = roleFromDecoderName(joined, extension);
  if (decoderRole) {
    return decoderRole;
  }

  if (extension === ".wasm") {
    return "wasm";
  }

  if (isWorkerLike(asset)) {
    return "worker";
  }

  if (extension === ".basis") {
    return /transcoder|decoder/i.test(joined) ? "basis-transcoder" : "texture";
  }

  if (extension === ".bin") {
    return MODEL_PATH_RE.test(joined) ? "gltf-buffer" : "unknown";
  }

  if (extension && TEXTURE_EXTENSIONS.has(extension)) {
    return MODEL_PATH_RE.test(joined) || asset.is3dAsset ? "texture" : "image";
  }

  if (contentType.startsWith("image/") && MODEL_PATH_RE.test(joined)) {
    return "texture";
  }

  if (extension === ".js" || extension === ".mjs" || contentType.includes("javascript")) {
    if (/model-viewer/i.test(joined)) {
      return "model-viewer";
    }

    if (/three|babylon|gltfloader|dracoloader|ktx2loader|meshopt/i.test(joined)) {
      return "script";
    }
  }

  return "unknown";
}

export function isThreeDAssetRole(role: AssetRole): boolean {
  return (
    role === "gltf" ||
    role === "glb" ||
    role === "gltf-buffer" ||
    role === "texture" ||
    role === "ktx2-texture" ||
    role === "draco-compressed" ||
    role === "draco-decoder" ||
    role === "basis-transcoder" ||
    role === "meshopt-decoder" ||
    role === "wasm" ||
    role === "worker" ||
    role === "model-viewer"
  );
}

export function isDecoderAssetRole(role: AssetRole | undefined): boolean {
  return role === "draco-decoder" || role === "basis-transcoder" || role === "meshopt-decoder";
}
