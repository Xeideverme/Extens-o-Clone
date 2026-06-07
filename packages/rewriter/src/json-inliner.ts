import type { AssetManifest, AssetRecord } from "@clone3d/shared";
import { getExtension } from "@clone3d/shared";
import { resolvePublicUrl } from "./asset-map";
import type { InlineResponse, TextAssetRecord } from "./types";

export interface BuildInlineResponsesResult {
  inlineResponses: Record<string, InlineResponse>;
  jsonInlined: number;
  warnings: string[];
}

export function buildInlineJsonResponses(
  textAssets: TextAssetRecord[],
  manifest: AssetManifest,
  inlineThresholdBytes: number
): BuildInlineResponsesResult {
  const inlineResponses: Record<string, InlineResponse> = {};
  const warnings: string[] = [];
  let jsonInlined = 0;

  for (const textAsset of textAssets) {
    const asset = textAsset.asset;
    if (!isJsonAsset(asset) || (asset.size ?? textAsset.text.length) > inlineThresholdBytes) {
      continue;
    }

    try {
      const parsed = JSON.parse(textAsset.text) as unknown;
      const rewritten = rewriteJsonValue(parsed, asset.normalizedUrl, manifest);
      const bodyText = JSON.stringify(rewritten);
      const response: InlineResponse = {
        status: 200,
        contentType: asset.contentType || "application/json; charset=utf-8",
        bodyText
      };

      for (const key of responseKeys(asset)) {
        inlineResponses[key] = response;
      }

      jsonInlined += 1;
    } catch (error) {
      warnings.push(`json inline skipped for ${asset.normalizedUrl}: ${errorToMessage(error)}`);
    }
  }

  return {
    inlineResponses,
    jsonInlined,
    warnings
  };
}

function rewriteJsonValue(value: unknown, baseUrl: string, manifest: AssetManifest): unknown {
  if (typeof value === "string") {
    return resolvePublicUrl(value, baseUrl, manifest) ?? value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => rewriteJsonValue(item, baseUrl, manifest));
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      output[key] = rewriteJsonValue(nestedValue, baseUrl, manifest);
    }
    return output;
  }

  return value;
}

function isJsonAsset(asset: AssetRecord): boolean {
  return Boolean(
    asset.contentType?.toLowerCase().includes("application/json") ||
      getExtension(asset.normalizedUrl) === ".json" ||
      getExtension(asset.originalUrl) === ".json"
  );
}

function responseKeys(asset: AssetRecord): string[] {
  const keys = new Set<string>([asset.originalUrl, asset.normalizedUrl]);

  try {
    const url = new URL(asset.normalizedUrl);
    keys.add(`${url.pathname}${url.search}`);
    keys.add(url.pathname);
  } catch {
    // Raw keys are enough for non-standard URL values.
  }

  return [...keys].filter(Boolean);
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
