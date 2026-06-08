import type {
  ApiReplayReport,
  AppHtmlValidationReport,
  AssetRecord,
  JobRecord,
  RewriteReport,
  ThreeDPreparationReport
} from "@clone3d/shared";
import { getAssetPublicUrl } from "./asset-serving";

export interface ValidateGeneratedAppHtmlInput {
  html: string;
  job: JobRecord;
  assets: AssetRecord[];
  rewriteReport?: RewriteReport;
  apiReplayReport?: ApiReplayReport;
  threeDReport?: ThreeDPreparationReport;
}

const SECRET_PATTERNS = [
  /uploadAuthToken/i,
  /workerBearerToken/i,
  /Authorization/i,
  /\bBearer\s+[A-Za-z0-9._~+/-]+/i,
  /Set-Cookie/i,
  /\bCookie\b/i,
  /userhash/i,
  /UPLOAD_BEARER_TOKEN/i,
  /access_token/i,
  /refresh_token/i,
  /id_token/i,
  /csrf/i,
  /session/i
];

export function validateGeneratedAppHtml(input: ValidateGeneratedAppHtmlInput): AppHtmlValidationReport {
  const html = input.html;
  const hasAssetManifest = html.includes("__CLONE3D_ASSET_MANIFEST__");
  const hasRuntimeResolver = html.includes("__CLONE3D_RUNTIME_INSTALLED__");
  const hasApiReplayMap = html.includes("__CLONE3D_API_REPLAY__");
  const hasReplayableApiSnapshots = Boolean(
    input.apiReplayReport &&
      (input.apiReplayReport.replayMapEntries > 0 ||
        input.apiReplayReport.inlinedResponses > 0 ||
        input.apiReplayReport.rewrittenResponses > 0)
  );
  const possibleSecretLeaks = findMatches(html, SECRET_PATTERNS).slice(0, 20);
  const moduleScriptsDirectToCatbox = findRegexMatches(
    html,
    /<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']https:\/\/files\.catbox\.moe\/[^"']+["'][^>]*>/gi
  );
  const dynamicImportsDirectToCatbox = findRegexMatches(
    html,
    /\bimport\s*\(\s*["']https:\/\/files\.catbox\.moe\/[^"']+["']\s*\)/gi
  );
  const synthesizedCatboxUrls = findSynthesizedCatboxUrls(html, input.assets);
  const catboxDirectCorsRisks = unique([
    ...moduleScriptsDirectToCatbox,
    ...dynamicImportsDirectToCatbox,
    ...findRegexMatches(html, /\bfetch\s*\(\s*["']https:\/\/files\.catbox\.moe\/[^"']+["']\s*\)/gi),
    ...findRegexMatches(html, /WebAssembly\.instantiateStreaming\s*\(\s*fetch\s*\(\s*["']https:\/\/files\.catbox\.moe\/[^"']+["']/gi),
    ...findRegexMatches(html, /<link\b[^>]*\brel=["'][^"']*modulepreload[^"']*["'][^>]*\bhref=["']https:\/\/files\.catbox\.moe\/[^"']+["'][^>]*>/gi),
    ...synthesizedCatboxUrls
  ]).slice(0, 50);
  const nextImageUnresolved = unique([
    ...findRegexMatches(html, /file:\/\/[^"'\s>]*\/_next\/image[^"'\s>]*/gi),
    ...findRegexMatches(html, /\b(?:src|href)=["']\/_next\/image[^"']*["']/gi),
    ...findRegexMatches(html, /\bsrcset=["'][^"']*\/_next\/image[^"']*["']/gi),
    ...findRegexMatches(html, /url\(\s*["']?\/_next\/image[^)"']*/gi)
  ]).slice(0, 50);
  const inlineScriptSyntaxWarnings = findRegexMatches(
    html,
    /<script\b(?![^>]*\bsrc=)(?![^>]*\btype=["']application\/json["'])[^>]*>[\s\S]*?<\/script[\s\S]*?<\/script>/gi
  ).slice(0, 20);
  const unresolvedRelativeFetchCandidates = findRegexMatches(
    html,
    /\bfetch\s*\(\s*["'](?:\.{1,2}\/|\/api\/)[^"']+["']\s*\)/gi
  ).slice(0, 50);
  const unresolvedLocalSrcCandidates = findRegexMatches(
    html,
    /\b(?:src|href)=["'](?:\.{1,2}\/|\/_next\/|\/api\/)[^"']+["']/gi
  ).slice(0, 50);
  const criticalAssetsMissing = findCriticalAssetsMissing(input.assets);
  const transientWorkerWarnings = findTransientWorkerWarnings(input.assets);
  const blockingSecretLeaks = possibleSecretLeaks.filter(isBlockingSecretLeak);

  const errors = [
    !hasAssetManifest ? "missing-asset-manifest" : undefined,
    !hasRuntimeResolver ? "missing-runtime-resolver" : undefined,
    hasReplayableApiSnapshots && !hasApiReplayMap ? "missing-api-replay-map" : undefined,
    ...blockingSecretLeaks.map((value) => `possible-secret-leak:${value}`),
    ...catboxDirectCorsRisks.map((value) => `catbox-direct-cors-risk:${value}`),
    ...nextImageUnresolved.map((value) => `next-image-unresolved:${value}`),
    ...criticalAssetsMissing.map((value) => `critical-assets-missing:${value}`),
    html.includes("chrome-extension://") ? "chrome-extension-url-leak" : undefined
  ].filter(Boolean) as string[];
  const warnings = [
    ...possibleSecretLeaks
      .filter((value) => !isBlockingSecretLeak(value))
      .map((value) => `possible-sensitive-string:${value}`),
    ...transientWorkerWarnings,
    ...inlineScriptSyntaxWarnings.map((value) => `inline-script-syntax-warning:${value}`),
    ...unresolvedRelativeFetchCandidates.map((value) => `relative-fetch-candidate:${value}`),
    ...unresolvedLocalSrcCandidates.map((value) => `local-src-candidate:${value}`)
  ];

  const assetMapEntries = countJsonScriptEntries(html, "__CLONE3D_ASSET_MANIFEST__");
  const apiReplayEntries = countJsonScriptEntries(html, "__CLONE3D_API_REPLAY__");

  return {
    jobId: input.job.id,
    createdAt: Date.now(),
    ok: errors.length === 0,
    errors: unique(errors),
    warnings: unique(warnings),
    hasAssetManifest,
    hasRuntimeResolver,
    hasApiReplayMap,
    hasRewriteReport: html.includes("Clone3D Snapshot Rewrite Report") || html.includes("__CLONE3D_REWRITE_REPORT__"),
    unresolvedRelativeFetchCandidates,
    unresolvedLocalSrcCandidates,
    possibleSecretLeaks,
    assetMapEntries,
    apiReplayEntries,
    catboxDirectCorsRisks,
    nextImageUnresolved,
    moduleScriptsDirectToCatbox,
    dynamicImportsDirectToCatbox,
    criticalAssetsMissing,
    inlineScriptSyntaxWarnings
  };
}

function isBlockingSecretLeak(value: string): boolean {
  return /uploadAuthToken|workerBearerToken|Authorization|\bBearer\b|Set-Cookie|\bCookie\b|userhash|UPLOAD_BEARER_TOKEN|chrome-extension:\/\//i.test(value);
}

export function findCriticalAssetsMissing(assets: AssetRecord[]): string[] {
  return assets
    .filter((asset) => isCriticalAsset(asset) && !getAssetPublicUrl(asset) && !hasLocalTextFallback(asset))
    .map((asset) => asset.normalizedUrl || asset.originalUrl)
    .slice(0, 100);
}

export function isCriticalAsset(asset: AssetRecord): boolean {
  if (isTransientWorkerWithoutBlob(asset)) {
    return false;
  }

  const contentType = asset.contentType?.toLowerCase() ?? "";
  const text = `${asset.normalizedUrl} ${asset.originalUrl} ${asset.detectedExtension ?? ""}`.toLowerCase();
  return Boolean(
    asset.assetRole === "script" ||
      asset.assetRole === "css" ||
      asset.assetRole === "json" ||
      asset.assetRole === "gltf" ||
      asset.assetRole === "glb" ||
      asset.assetRole === "gltf-buffer" ||
      asset.assetRole === "wasm" ||
      asset.assetRole === "worker" ||
      asset.assetRole === "draco-decoder" ||
      asset.assetRole === "basis-transcoder" ||
      asset.assetRole === "meshopt-decoder" ||
      asset.assetRole === "ktx2-texture" ||
      asset.is3dAsset ||
      contentType.includes("javascript") ||
      contentType.includes("text/css") ||
      contentType.includes("application/json") ||
      contentType.includes("model/gltf") ||
      contentType.includes("application/wasm") ||
      /\.(js|mjs|css|json|gltf|glb|bin|wasm|drc|ktx2|basis)(?:[?#\s]|$)/i.test(text)
  );
}

export function findTransientWorkerWarnings(assets: AssetRecord[]): string[] {
  return assets
    .filter(isTransientWorkerWithoutBlob)
    .map((asset) => `transient-worker-without-blob:${asset.normalizedUrl || asset.originalUrl}`)
    .slice(0, 100);
}

export function isTransientWorkerWithoutBlob(asset: AssetRecord): boolean {
  const url = asset.normalizedUrl || asset.originalUrl;
  return Boolean(
    asset.assetRole === "worker" &&
      asset.status === "skipped" &&
      asset.source?.includes("worker-hook") &&
      !asset.localBlobId &&
      !asset.publicUrl &&
      !asset.preparedPublicUrl &&
      isUuidLikeUrl(url) &&
      !hasScriptExtension(url)
  );
}

function isUuidLikeUrl(value: string): boolean {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  try {
    const segment = new URL(value).pathname.split("/").filter(Boolean).at(-1) ?? "";
    return uuidPattern.test(segment);
  } catch {
    const segment = value.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1) ?? "";
    return uuidPattern.test(segment);
  }
}

function hasScriptExtension(value: string): boolean {
  try {
    return /\.(?:js|mjs)$/i.test(new URL(value).pathname);
  } catch {
    return /\.(?:js|mjs)(?:[?#]|$)/i.test(value);
  }
}

function hasLocalTextFallback(asset: AssetRecord): boolean {
  const contentType = asset.contentType?.toLowerCase() ?? "";
  return Boolean(
    asset.localBlobId &&
      (contentType.startsWith("text/") ||
        contentType.includes("javascript") ||
        contentType.includes("json") ||
        /\.(js|mjs|css|json)(?:[?#\s]|$)/i.test(`${asset.normalizedUrl} ${asset.originalUrl}`))
  );
}

function findMatches(value: string, patterns: RegExp[]): string[] {
  return unique(patterns.flatMap((pattern) => findRegexMatches(value, pattern)));
}

function findRegexMatches(value: string, pattern: RegExp): string[] {
  const matches: string[] = [];
  for (const match of value.matchAll(pattern)) {
    matches.push(match[0].slice(0, 240));
  }
  return unique(matches);
}

function findSynthesizedCatboxUrls(html: string, assets: AssetRecord[]): string[] {
  const risks: string[] = [];
  for (const asset of assets) {
    const publicUrl = getAssetPublicUrl(asset);
    const filename = filenameFromOriginal(asset);
    if (!filename || !publicUrl || publicUrl.endsWith(`/${filename}`)) {
      continue;
    }

    const synthesized = `https://files.catbox.moe/${filename}`;
    if (html.includes(synthesized)) {
      risks.push(`synthesized-catbox-url:${synthesized}`);
    }
  }

  return unique(risks);
}

function filenameFromOriginal(asset: AssetRecord): string | undefined {
  for (const value of [asset.normalizedUrl, asset.originalUrl]) {
    try {
      const filename = new URL(value).pathname.split("/").filter(Boolean).at(-1);
      if (filename) {
        return filename;
      }
    } catch {
      const filename = value.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1);
      if (filename) {
        return filename;
      }
    }
  }

  return undefined;
}

function countJsonScriptEntries(html: string, id: string): number {
  const pattern = new RegExp(`<script\\b[^>]*\\bid=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`, "i");
  const raw = html.match(pattern)?.[1];
  if (!raw) {
    return 0;
  }

  try {
    return Object.keys(JSON.parse(raw)).length;
  } catch {
    return 0;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
