import type { ApiReplayReport, ApiSnapshotRecord, AssetManifest } from "@clone3d/shared";
import { resolvePublicUrl } from "./asset-map";
import type { InlineResponse } from "./types";

export interface ApiReplayCaptureSettings {
  apiReplayEnabled: boolean;
  apiReplayMaxBodyKb: number;
  apiReplayCaptureSameOriginOnly: boolean;
  apiReplayAllowTextPlain: boolean;
}

export interface ShouldCaptureApiResponseInput {
  method: string;
  url: string;
  pageUrl?: string;
  status: number;
  contentType: string;
  size?: number;
  hasAuthorizationHeader?: boolean;
  settings: ApiReplayCaptureSettings;
}

export type ApiReplaySkipReason =
  | "disabled"
  | "sensitive-url"
  | "too-large"
  | "unsupported-content-type"
  | "unsupported-method"
  | "authorization-header"
  | "non-success-status"
  | "cross-origin";

export interface RewriteApiSnapshotBodyInput {
  bodyText: string;
  contentType: string;
  url: string;
  manifest: AssetManifest;
}

export interface RewriteApiSnapshotBodyOutput {
  bodyText: string;
  changed: boolean;
  rewrites: number;
  unresolvedUrls: string[];
  warnings: string[];
}

export interface BuildApiReplayMapResult {
  replayMap: Record<string, InlineResponse>;
  warnings: string[];
  entries: number;
}

const SENSITIVE_URL_RE = /(?:login|logout|auth|oauth|token|session|csrf|password|passwd|account|user|me|profile|billing|checkout|payment|cart|order|admin|private|secret)/i;
const ASSET_REFERENCE_RE = /\.(?:glb|gltf|bin|drc|ktx2|basis|wasm|png|jpe?g|webp|avif|svg|gif|ogg|mp3|wav|mp4|webm|json|mjs?|css|hdr|exr)(?:[?#].*)?$/i;
const PATH_HINT_RE = /\/(?:assets|models|textures|draco|basis|meshopt)\//i;

export function isSensitiveApiUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return SENSITIVE_URL_RE.test(`${url.pathname}${url.search}`);
  } catch {
    return SENSITIVE_URL_RE.test(value);
  }
}

export function isReplayableContentType(contentType: string, allowTextPlain = true): boolean {
  const normalized = contentType.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    normalized === "application/json" ||
    normalized === "text/json" ||
    normalized === "application/manifest+json" ||
    normalized === "application/vnd.api+json" ||
    normalized === "model/gltf+json" ||
    normalized.endsWith("+json") ||
    (allowTextPlain && normalized === "text/plain")
  );
}

export function shouldCaptureApiResponse(input: ShouldCaptureApiResponseInput): { ok: true } | { ok: false; reason: ApiReplaySkipReason } {
  if (!input.settings.apiReplayEnabled) {
    return { ok: false, reason: "disabled" };
  }

  if (input.method.toUpperCase() !== "GET") {
    return { ok: false, reason: "unsupported-method" };
  }

  if (input.status < 200 || input.status > 299) {
    return { ok: false, reason: "non-success-status" };
  }

  if (input.hasAuthorizationHeader) {
    return { ok: false, reason: "authorization-header" };
  }

  if (isSensitiveApiUrl(input.url)) {
    return { ok: false, reason: "sensitive-url" };
  }

  if (!isReplayableContentType(input.contentType, input.settings.apiReplayAllowTextPlain)) {
    return { ok: false, reason: "unsupported-content-type" };
  }

  if (input.size !== undefined && input.size > input.settings.apiReplayMaxBodyKb * 1024) {
    return { ok: false, reason: "too-large" };
  }

  if (input.settings.apiReplayCaptureSameOriginOnly && input.pageUrl && !isSameOrigin(input.url, input.pageUrl)) {
    return { ok: false, reason: "cross-origin" };
  }

  return { ok: true };
}

export function rewriteApiSnapshotBody(input: RewriteApiSnapshotBodyInput): RewriteApiSnapshotBodyOutput {
  const warnings: string[] = [];
  const unresolvedUrls: string[] = [];

  if (looksLikeJson(input.contentType, input.bodyText)) {
    try {
      const json = JSON.parse(input.bodyText) as unknown;
      let rewrites = 0;
      walkJsonStrings(json, (value) => {
        if (!looksLikeApiAssetReference(value)) {
          return value;
        }

        const publicUrl = resolvePublicUrl(value, input.url, input.manifest);
        if (!publicUrl) {
          unresolvedUrls.push(value);
          return value;
        }

        rewrites += 1;
        return publicUrl;
      });

      return {
        bodyText: rewrites > 0 ? JSON.stringify(json, null, 2) : input.bodyText,
        changed: rewrites > 0,
        rewrites,
        unresolvedUrls: unique(unresolvedUrls),
        warnings
      };
    } catch (error) {
      warnings.push(`api json parse failed; falling back to text rewrite: ${errorToMessage(error)}`);
    }
  }

  return rewriteTextBody(input.bodyText, input.url, input.manifest, warnings);
}

export function buildApiReplayMap(
  snapshots: ApiSnapshotRecord[],
  manifest: AssetManifest
): BuildApiReplayMapResult {
  const replayMap: Record<string, InlineResponse> = {};
  const warnings: string[] = [];

  for (const snapshot of snapshots) {
    if (!snapshot.replayable || !snapshot.bodyText || snapshot.method !== "GET") {
      continue;
    }

    const rewritten = rewriteApiSnapshotBody({
      bodyText: snapshot.bodyText,
      contentType: snapshot.contentType,
      url: snapshot.normalizedUrl,
      manifest
    });
    warnings.push(...rewritten.warnings);

    const entry = {
      status: snapshot.httpStatus || 200,
      contentType: snapshot.contentType || "application/json; charset=utf-8",
      bodyText: rewritten.bodyText
    };

    for (const key of apiReplayKeys(snapshot.method, snapshot.url, snapshot.normalizedUrl)) {
      const existing = replayMap[key];
      if (existing && existing.bodyText !== entry.bodyText) {
        delete replayMap[key];
        warnings.push(`api replay key omitted because of collision: ${redactApiReplayKey(key)}`);
        continue;
      }

      replayMap[key] = entry;
    }
  }

  return {
    replayMap,
    warnings: unique(warnings),
    entries: Object.keys(replayMap).length
  };
}

export function apiReplayKeys(method: string, rawUrl: string, normalizedUrl: string): string[] {
  const normalizedMethod = method.toUpperCase();
  const keys = new Set<string>();
  for (const value of [rawUrl, normalizedUrl]) {
    if (!value) {
      continue;
    }

    keys.add(`${normalizedMethod} ${value}`);
    try {
      const url = new URL(value);
      keys.add(`${normalizedMethod} ${url.href}`);
      keys.add(`${normalizedMethod} ${url.href.split("#")[0] ?? url.href}`);
      keys.add(`${normalizedMethod} ${url.pathname}${url.search}`);
      keys.add(`${normalizedMethod} ${url.pathname}`);
    } catch {
      // Raw key is enough.
    }
  }

  return [...keys];
}

export function createApiReplayReport(jobId: string): ApiReplayReport {
  return {
    jobId,
    startedAt: Date.now(),
    capturedResponses: 0,
    storedResponses: 0,
    rewrittenResponses: 0,
    inlinedResponses: 0,
    skippedSensitive: 0,
    skippedTooLarge: 0,
    skippedUnsupportedContentType: 0,
    skippedUnsupportedMethod: 0,
    replayMapEntries: 0,
    warnings: [],
    errors: []
  };
}

function rewriteTextBody(
  bodyText: string,
  baseUrl: string,
  manifest: AssetManifest,
  warnings: string[]
): RewriteApiSnapshotBodyOutput {
  let rewrites = 0;
  const unresolvedUrls: string[] = [];
  const body = bodyText.replace(/(["']?)(https?:\/\/[^"'\s]+|(?:\.{1,2}\/|\/)[^"'\s,)}]+|[^"'\s,)}]+)(\1)/g, (match, before: string, value: string, after: string) => {
    if (!looksLikeApiAssetReference(value)) {
      return match;
    }

    const publicUrl = resolvePublicUrl(value, baseUrl, manifest);
    if (!publicUrl) {
      unresolvedUrls.push(value);
      return match;
    }

    rewrites += 1;
    return `${before}${publicUrl}${after}`;
  });

  return {
    bodyText: body,
    changed: rewrites > 0,
    rewrites,
    unresolvedUrls: unique(unresolvedUrls),
    warnings
  };
}

function walkJsonStrings(value: unknown, visitor: (value: string) => string): void {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (typeof item === "string") {
        value[index] = visitor(item);
      } else {
        walkJsonStrings(item, visitor);
      }
    }
    return;
  }

  if (!value || typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "string") {
      record[key] = visitor(item);
    } else {
      walkJsonStrings(item, visitor);
    }
  }
}

function looksLikeApiAssetReference(value: string): boolean {
  const trimmed = value.trim();
  return (
    /^https?:\/\//i.test(trimmed) ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("/") ||
    ASSET_REFERENCE_RE.test(trimmed) ||
    PATH_HINT_RE.test(trimmed)
  );
}

function looksLikeJson(contentType: string, bodyText: string): boolean {
  const normalized = contentType.toLowerCase();
  const trimmed = bodyText.trim();
  return normalized.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("[");
}

function isSameOrigin(url: string, pageUrl: string): boolean {
  try {
    return new URL(url, pageUrl).origin === new URL(pageUrl).origin;
  } catch {
    return false;
  }
}

function redactApiReplayKey(key: string): string {
  try {
    const [method, value] = key.split(/\s+/, 2);
    const url = new URL(value);
    return `${method} ${url.origin}${url.pathname}`;
  } catch {
    return key.split("?")[0] ?? key;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
