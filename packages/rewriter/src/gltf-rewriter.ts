import type { AssetManifest, AssetRecord } from "@clone3d/shared";
import { resolvePublicUrl, shouldIgnoreUrl } from "./asset-map";
import { looksLike3dReference } from "./three-url-patterns";

export interface GltfFoundUri {
  jsonPath: string;
  rawUri: string;
  resolvedUrl: string;
  publicUrl?: string;
  assetId?: string;
  kind: "buffer" | "image" | "extension" | "generic-uri";
}

export interface GltfAnalysisResult {
  assetId: string;
  gltfUrl: string;
  foundUris: GltfFoundUri[];
  unresolvedUris: string[];
  warnings: string[];
}

export interface RewriteGltfInput {
  gltfAsset: AssetRecord;
  gltfText: string;
  baseUrl: string;
  manifest: AssetManifest;
  allAssets: AssetRecord[];
}

export interface RewriteGltfOutput {
  changed: boolean;
  gltfText: string;
  rewrites: number;
  unresolvedUris: string[];
  warnings: string[];
}

const URI_KEYS = new Set(["uri", "url", "src", "path"]);

export function analyzeGltf(input: {
  gltfAsset: AssetRecord;
  gltfText: string;
  baseUrl: string;
  manifest: AssetManifest;
  allAssets: AssetRecord[];
}): GltfAnalysisResult {
  const warnings: string[] = [];
  const foundUris: GltfFoundUri[] = [];
  const unresolvedUris: string[] = [];

  let json: unknown;
  try {
    json = JSON.parse(input.gltfText) as unknown;
  } catch (error) {
    return {
      assetId: input.gltfAsset.id,
      gltfUrl: input.gltfAsset.normalizedUrl,
      foundUris: [],
      unresolvedUris: [],
      warnings: [`invalid gltf json: ${errorToMessage(error)}`]
    };
  }

  const resolver = createAssetResolver(input.allAssets);
  walkJson(json, "$", (path, key, value) => {
    if (!URI_KEYS.has(key) || !looksLikeGltfUri(value)) {
      return;
    }

    if (value.trim().toLowerCase().startsWith("blob:")) {
      warnings.push(`blob URI inside GLTF was left unresolved: ${value}`);
      unresolvedUris.push(value);
      return;
    }

    if (shouldIgnoreUrl(value)) {
      return;
    }

    const resolvedUrl = absolutize(value, input.baseUrl) ?? value;
    const publicUrl = resolvePublicUrl(value, input.baseUrl, input.manifest);
    const asset = resolver(value, input.baseUrl);
    const found = {
      jsonPath: path,
      rawUri: value,
      resolvedUrl,
      publicUrl,
      assetId: asset?.id,
      kind: inferKind(path)
    } satisfies GltfFoundUri;
    foundUris.push(found);

    if (!publicUrl) {
      unresolvedUris.push(value);
    }
  });

  return {
    assetId: input.gltfAsset.id,
    gltfUrl: input.gltfAsset.normalizedUrl,
    foundUris,
    unresolvedUris: unique(unresolvedUris),
    warnings: unique(warnings)
  };
}

export function rewriteGltf(input: RewriteGltfInput): RewriteGltfOutput {
  const warnings: string[] = [];
  const unresolvedUris: string[] = [];
  let rewrites = 0;
  let json: unknown;

  try {
    json = JSON.parse(input.gltfText) as unknown;
  } catch (error) {
    return {
      changed: false,
      gltfText: input.gltfText,
      rewrites: 0,
      unresolvedUris: [],
      warnings: [`invalid gltf json: ${errorToMessage(error)}`]
    };
  }

  walkJson(json, "$", (_path, key, value, setValue) => {
    if (!URI_KEYS.has(key) || !looksLikeGltfUri(value)) {
      return;
    }

    const trimmed = value.trim();
    if (!trimmed || /^data:/i.test(trimmed)) {
      return;
    }

    if (/^blob:/i.test(trimmed)) {
      warnings.push(`blob URI inside GLTF was left unchanged: ${value}`);
      unresolvedUris.push(value);
      return;
    }

    const publicUrl = resolvePublicUrl(value, input.baseUrl, input.manifest);
    if (!publicUrl) {
      unresolvedUris.push(value);
      return;
    }

    if (publicUrl !== value) {
      setValue(publicUrl);
      rewrites += 1;
    }
  });

  return {
    changed: rewrites > 0,
    gltfText: rewrites > 0 ? JSON.stringify(json, null, 2) : input.gltfText,
    rewrites,
    unresolvedUris: unique(unresolvedUris),
    warnings: unique(warnings)
  };
}

function walkJson(
  value: unknown,
  path: string,
  visitor: (path: string, key: string, value: string, setValue: (nextValue: string) => void) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkJson(item, `${path}[${index}]`, visitor));
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    const childPath = `${path}.${key}`;
    if (typeof child === "string") {
      visitor(childPath, key.toLowerCase(), child, (nextValue) => {
        record[key] = nextValue;
      });
    } else {
      walkJson(child, childPath, visitor);
    }
  }
}

function looksLikeGltfUri(value: string): boolean {
  const trimmed = value.trim();
  return Boolean(
    trimmed &&
      !trimmed.startsWith("#") &&
      (/^https?:\/\//i.test(trimmed) ||
        trimmed.startsWith("./") ||
        trimmed.startsWith("../") ||
        trimmed.startsWith("/") ||
        looksLike3dReference(trimmed))
  );
}

function inferKind(path: string): GltfFoundUri["kind"] {
  if (/\.buffers\[\d+\]\.uri$/i.test(path)) {
    return "buffer";
  }

  if (/\.images\[\d+\]\.uri$/i.test(path)) {
    return "image";
  }

  if (/extensions/i.test(path)) {
    return "extension";
  }

  return "generic-uri";
}

function createAssetResolver(assets: AssetRecord[]) {
  const strong = new Map<string, AssetRecord>();
  const filenames = new Map<string, AssetRecord | "collision">();

  for (const asset of assets) {
    for (const value of [asset.originalUrl, asset.normalizedUrl, asset.publicUrl, asset.preparedPublicUrl].filter(
      Boolean
    ) as string[]) {
      strong.set(value, asset);
      const abs = absolutize(value, asset.normalizedUrl);
      if (abs) {
        strong.set(abs, asset);
        strong.set(stripHash(abs), asset);
        try {
          const url = new URL(abs);
          strong.set(`${url.pathname}${url.search}`, asset);
          strong.set(url.pathname, asset);
          const filename = url.pathname.split("/").filter(Boolean).at(-1);
          if (filename) {
            const current = filenames.get(filename);
            filenames.set(filename, current && current !== asset ? "collision" : asset);
          }
        } catch {
          // Strong raw key is enough for malformed URLs.
        }
      }
    }
  }

  return (raw: string, baseUrl: string): AssetRecord | undefined => {
    const candidates = new Set<string>([raw]);
    const abs = absolutize(raw, baseUrl);
    if (abs) {
      candidates.add(abs);
      candidates.add(stripHash(abs));
      try {
        const url = new URL(abs);
        candidates.add(`${url.pathname}${url.search}`);
        candidates.add(url.pathname);
        const filename = url.pathname.split("/").filter(Boolean).at(-1);
        if (filename) {
          candidates.add(filename);
        }
      } catch {
        // Keep absolute candidate.
      }
    }

    for (const candidate of candidates) {
      const strongMatch = strong.get(candidate);
      if (strongMatch) {
        return strongMatch;
      }

      const filenameMatch = filenames.get(candidate);
      if (filenameMatch && filenameMatch !== "collision") {
        return filenameMatch;
      }
    }

    return undefined;
  };
}

function absolutize(value: string, baseUrl: string): string | undefined {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return undefined;
  }
}

function stripHash(value: string): string {
  return value.split("#")[0] ?? value;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
