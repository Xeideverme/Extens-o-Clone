import { getExtension } from "@clone3d/shared";
import type { AssetRecord, RuntimeAssetServingSettings } from "@clone3d/shared";

export const DEFAULT_RUNTIME_ASSET_SERVING_SETTINGS: RuntimeAssetServingSettings = {
  assetServingMode: "auto",
  corsProxyEnabled: false,
  corsProxyEndpoint: "",
  moduleServingStrategy: "auto",
  selfContainedMaxInlineAssetKb: 2048
};

const CORS_SENSITIVE_EXTENSIONS = new Set([
  ".js",
  ".mjs",
  ".json",
  ".gltf",
  ".glb",
  ".bin",
  ".wasm",
  ".drc",
  ".ktx2",
  ".basis",
  ".hdr",
  ".exr"
]);

const CORS_SENSITIVE_ROLES = new Set([
  "gltf",
  "glb",
  "gltf-buffer",
  "ktx2-texture",
  "draco-compressed",
  "draco-decoder",
  "basis-transcoder",
  "meshopt-decoder",
  "wasm",
  "worker",
  "model-viewer"
]);

export function normalizeRuntimeAssetServingSettings(
  settings?: Partial<RuntimeAssetServingSettings>
): RuntimeAssetServingSettings {
  return {
    ...DEFAULT_RUNTIME_ASSET_SERVING_SETTINGS,
    ...settings,
    assetServingMode: isAssetServingMode(settings?.assetServingMode)
      ? settings.assetServingMode
      : DEFAULT_RUNTIME_ASSET_SERVING_SETTINGS.assetServingMode,
    moduleServingStrategy: isModuleServingStrategy(settings?.moduleServingStrategy)
      ? settings.moduleServingStrategy
      : DEFAULT_RUNTIME_ASSET_SERVING_SETTINGS.moduleServingStrategy,
    corsProxyEnabled: Boolean(settings?.corsProxyEnabled),
    corsProxyEndpoint: normalizeEndpoint(settings?.corsProxyEndpoint),
    selfContainedMaxInlineAssetKb: clampInteger(settings?.selfContainedMaxInlineAssetKb, 64, 51200, 2048)
  };
}

export function getAssetPublicUrl(asset: AssetRecord): string | undefined {
  return asset.preparedPublicUrl || asset.publicUrl;
}

export function requiresCorsSafeServing(asset: AssetRecord): boolean {
  const contentType = asset.contentType?.toLowerCase() ?? "";
  const extension = getExtension(asset.normalizedUrl) || getExtension(asset.originalUrl) || asset.detectedExtension;
  const role = asset.assetRole;
  const urlText = `${asset.normalizedUrl} ${asset.originalUrl}`.toLowerCase();

  return Boolean(
    (extension && CORS_SENSITIVE_EXTENSIONS.has(extension)) ||
      (role && CORS_SENSITIVE_ROLES.has(role)) ||
      asset.is3dAsset ||
      contentType.includes("javascript") ||
      contentType.includes("ecmascript") ||
      contentType.includes("application/json") ||
      contentType.includes("model/gltf") ||
      contentType.includes("application/wasm") ||
      /(?:worker|decoder|transcoder|draco|basis|meshopt|ktx2loader|dracoloader)/i.test(urlText)
  );
}

export function toRuntimeAssetUrl(
  asset: AssetRecord,
  settings?: Partial<RuntimeAssetServingSettings>
): string | undefined {
  const normalizedSettings = normalizeRuntimeAssetServingSettings(settings);
  const publicUrl = getAssetPublicUrl(asset);
  if (!publicUrl) {
    return undefined;
  }

  if (normalizedSettings.assetServingMode === "catbox-direct") {
    return publicUrl;
  }

  if (normalizedSettings.assetServingMode === "catbox-cors-proxy") {
    return toCatboxProxyUrl(publicUrl, normalizedSettings) ?? publicUrl;
  }

  if (normalizedSettings.assetServingMode === "inline-blob" && requiresCorsSafeServing(asset)) {
    return publicUrl;
  }

  if (
    normalizedSettings.assetServingMode === "auto" &&
    requiresCorsSafeServing(asset) &&
    normalizedSettings.corsProxyEnabled
  ) {
    return toCatboxProxyUrl(publicUrl, normalizedSettings) ?? publicUrl;
  }

  return publicUrl;
}

export function toCatboxProxyUrl(
  publicUrl: string,
  settings?: Partial<RuntimeAssetServingSettings>
): string | undefined {
  const normalizedSettings = normalizeRuntimeAssetServingSettings(settings);
  if (!normalizedSettings.corsProxyEnabled || !normalizedSettings.corsProxyEndpoint) {
    return undefined;
  }

  const filename = getCatboxFilename(publicUrl);
  if (!filename) {
    return undefined;
  }

  return `${normalizedSettings.corsProxyEndpoint.replace(/\/+$/g, "")}/catbox/${encodeURIComponent(filename)}`;
}

export function getCatboxFilename(publicUrl: string): string | undefined {
  try {
    const url = new URL(publicUrl);
    if (url.hostname !== "files.catbox.moe") {
      return undefined;
    }

    const filename = url.pathname.split("/").filter(Boolean).at(-1);
    return filename && /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9]+$/.test(filename) ? filename : undefined;
  } catch {
    return undefined;
  }
}

export function isCatboxPublicUrl(value: string | undefined): boolean {
  return Boolean(value && getCatboxFilename(value));
}

function normalizeEndpoint(value: unknown): string {
  const endpoint = String(value ?? "").trim();
  if (!endpoint) {
    return "";
  }

  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href.replace(/\/+$/g, "") : "";
  } catch {
    return "";
  }
}

function clampInteger(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function isAssetServingMode(value: unknown): value is RuntimeAssetServingSettings["assetServingMode"] {
  return value === "auto" || value === "catbox-direct" || value === "catbox-cors-proxy" || value === "inline-blob";
}

function isModuleServingStrategy(value: unknown): value is RuntimeAssetServingSettings["moduleServingStrategy"] {
  return value === "auto" || value === "proxy" || value === "inline-source" || value === "inline-blob";
}
