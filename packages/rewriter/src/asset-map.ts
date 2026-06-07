import type { AssetManifest, AssetManifestEntry, AssetRecord, JobRecord } from "@clone3d/shared";
import type { BuildAssetManifestResult } from "./types";

export function buildAssetManifest(job: JobRecord, assets: AssetRecord[]): BuildAssetManifestResult {
  const entries: AssetManifestEntry[] = assets
    .filter((asset) => isPublicUrl(getAssetPublicUrl(asset)))
    .map((asset) => ({
      assetId: asset.id,
      originalUrl: asset.originalUrl,
      normalizedUrl: asset.normalizedUrl,
      publicUrl: getAssetPublicUrl(asset) ?? "",
      contentType: asset.contentType,
      detectedExtension: asset.detectedExtension,
      size: asset.size,
      sha256: asset.sha256,
      source: [...asset.source]
    }));
  const warnings: string[] = [];
  const map: Record<string, string> = {};
  const filenamePublicUrls = new Map<string, Set<string>>();

  for (const entry of entries) {
    for (const key of createStrongKeys(entry, job.pageUrl)) {
      addMapEntry(map, key, entry.publicUrl, warnings);
    }

    const filename = getFilename(entry.normalizedUrl) || getFilename(entry.originalUrl);
    if (filename) {
      const publicUrls = filenamePublicUrls.get(filename) ?? new Set<string>();
      publicUrls.add(entry.publicUrl);
      filenamePublicUrls.set(filename, publicUrls);
    }
  }

  for (const entry of entries) {
    const filename = getFilename(entry.normalizedUrl) || getFilename(entry.originalUrl);
    if (!filename) {
      continue;
    }

    const publicUrls = filenamePublicUrls.get(filename);
    if (publicUrls?.size === 1) {
      addMapEntry(map, filename, entry.publicUrl, warnings);
    } else if (publicUrls && publicUrls.size > 1) {
      warnings.push(`filename key omitted because of collision: ${filename}`);
    }
  }

  return {
    manifest: {
      jobId: job.id,
      pageUrl: job.pageUrl,
      createdAt: Date.now(),
      entries,
      map
    },
    warnings: unique(warnings)
  };
}

export function resolvePublicUrl(input: string, baseUrl: string, manifest: AssetManifest): string | undefined {
  const raw = input.trim();
  if (!raw || shouldIgnoreUrl(raw)) {
    return undefined;
  }

  const candidates = new Set<string>();
  candidates.add(raw);
  addEncodedVariants(candidates, raw);

  try {
    const absolute = new URL(raw, baseUrl);
    candidates.add(absolute.href);
    candidates.add(withoutHash(absolute.href));
    candidates.add(`${absolute.pathname}${absolute.search}`);
    candidates.add(absolute.pathname);
    candidates.add(`${absolute.origin}${absolute.pathname}`);
    const filename = getFilename(absolute.href);
    if (filename) {
      candidates.add(filename);
    }
  } catch {
    // Raw and encoded variants were already tried.
  }

  for (const candidate of candidates) {
    const resolved = manifest.map[candidate];
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

export function shouldIgnoreUrl(value: string): boolean {
  const trimmed = value.trim();
  return (
    !trimmed ||
    trimmed.startsWith("#") ||
    /^data:/i.test(trimmed) ||
    /^blob:/i.test(trimmed) ||
    /^javascript:/i.test(trimmed) ||
    /^about:/i.test(trimmed) ||
    /^mailto:/i.test(trimmed) ||
    /^tel:/i.test(trimmed)
  );
}

function createStrongKeys(entry: AssetManifestEntry, pageUrl: string): string[] {
  const keys = new Set<string>();
  addUrlKeys(keys, entry.originalUrl, pageUrl);
  addUrlKeys(keys, entry.normalizedUrl, pageUrl);
  return [...keys];
}

function addUrlKeys(keys: Set<string>, value: string, baseUrl: string): void {
  if (!value || shouldIgnoreUrl(value)) {
    return;
  }

  keys.add(value);
  keys.add(withoutHash(value));
  addEncodedVariants(keys, value);

  try {
    const url = new URL(value, baseUrl);
    keys.add(url.href);
    keys.add(withoutHash(url.href));
    keys.add(`${url.pathname}${url.search}`);
    keys.add(url.pathname);
    keys.add(`${url.origin}${url.pathname}`);
    addEncodedVariants(keys, url.href);
    addEncodedVariants(keys, `${url.pathname}${url.search}`);
    addEncodedVariants(keys, url.pathname);
    addEncodedVariants(keys, `${url.origin}${url.pathname}`);
  } catch {
    // Non-URL strings are still useful as raw manifest keys.
  }
}

function addEncodedVariants(keys: Set<string>, value: string): void {
  try {
    keys.add(decodeURI(value));
  } catch {
    // Keep original only.
  }

  try {
    keys.add(encodeURI(value));
  } catch {
    // Keep original only.
  }
}

function addMapEntry(map: Record<string, string>, key: string, publicUrl: string, warnings: string[]): void {
  const cleanedKey = key.trim();
  if (!cleanedKey) {
    return;
  }

  const existing = map[cleanedKey];
  if (existing && existing !== publicUrl) {
    delete map[cleanedKey];
    warnings.push(`manifest key omitted because of collision: ${cleanedKey}`);
    return;
  }

  map[cleanedKey] = publicUrl;
}

function isPublicUrl(value: string | undefined): boolean {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function getAssetPublicUrl(asset: AssetRecord): string | undefined {
  return asset.preparedPublicUrl || asset.publicUrl;
}

function withoutHash(value: string): string {
  const hashIndex = value.indexOf("#");
  return hashIndex >= 0 ? value.slice(0, hashIndex) : value;
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

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
