import type { AssetRecord, RewriteReport } from "@clone3d/shared";
import { DEFAULT_INLINE_THRESHOLD_BYTES, getExtension } from "@clone3d/shared";
import { buildAssetManifest } from "./asset-map";
import { rewriteHtml } from "./html-rewriter";
import { buildInlineJsonResponses } from "./json-inliner";
import { createRewriteReport, appendReportComment, escapeJsonForHtml } from "./report";
import { buildRuntimeResolverScript } from "./runtime-template";
import type { GenerateAppHtmlInput, GenerateAppHtmlOutput, TextAssetRecord } from "./types";

export function generateAppHtml(input: GenerateAppHtmlInput): GenerateAppHtmlOutput {
  const report = createRewriteReport(input.job.id);
  const manifestResult = buildAssetManifest(input.job, input.assets);
  const manifest = manifestResult.manifest;
  const textAssets = input.textAssets;
  const inlineThresholdBytes = input.inlineThresholdBytes || DEFAULT_INLINE_THRESHOLD_BYTES;
  const inlineJson = buildInlineJsonResponses(textAssets, manifest, inlineThresholdBytes);
  const cssByUrl = buildTextMap(textAssets.filter((textAsset) => isCssAsset(textAsset.asset)));
  const jsByUrl = buildTextMap(textAssets.filter((textAsset) => isJsAsset(textAsset.asset)));
  const manifestScript = `<script id="__CLONE3D_ASSET_MANIFEST__" type="application/json">${escapeJsonForHtml(JSON.stringify(manifest))}</script>`;
  const runtimeScript = input.runtimeResolverEnabled
    ? `<script>${buildRuntimeResolverScript(manifest, inlineJson.inlineResponses)}</script>`
    : "";

  report.assetsInManifest = manifest.entries.length;
  report.warnings.push(...manifestResult.warnings, ...inlineJson.warnings);
  if (input.assets.some((asset) => isGltfAsset(asset) && !asset.threeDPrepared)) {
    report.warnings.push("This job contains GLTF files that may require 3D preparation before app.html generation.");
  }

  const rewritten = rewriteHtml({
    html: input.htmlSnapshot.html,
    doctype: input.htmlSnapshot.doctype,
    pageUrl: input.job.pageUrl,
    baseUrl: input.htmlSnapshot.baseUrl || input.job.pageUrl,
    manifest,
    cssByUrl,
    jsByUrl,
    inlineResponses: inlineJson.inlineResponses,
    inlineThresholdBytes,
    runtimeScript,
    manifestScript
  });

  report.htmlRewrites = rewritten.htmlRewrites;
  report.cssRewrites = rewritten.cssRewrites;
  report.jsDirectRewrites = rewritten.jsDirectRewrites;
  report.jsonInlined = inlineJson.jsonInlined;
  report.unresolvedUrls.push(...rewritten.unresolvedUrls);
  report.warnings.push(...rewritten.warnings);

  const filename = buildOutputFilename(input.job.pageUrl);
  const reportWithInitialSize = finalizeReport(report, filename, byteLength(rewritten.html));
  const html = input.includeRewriteReportInHtml
    ? appendReportComment(rewritten.html, finalizeReport(report, filename, byteLength(appendReportComment(rewritten.html, reportWithInitialSize))))
    : rewritten.html;
  const finalReport = finalizeReport(report, filename, byteLength(html));

  return {
    html: input.includeRewriteReportInHtml ? appendReportComment(rewritten.html, finalReport) : html,
    report: finalReport,
    filename
  };
}

function buildTextMap(textAssets: TextAssetRecord[]): Map<string, string> {
  const map = new Map<string, string>();

  for (const textAsset of textAssets) {
    for (const key of textKeys(textAsset.asset)) {
      map.set(key, textAsset.text);
    }
  }

  return map;
}

function textKeys(asset: AssetRecord): string[] {
  const keys = new Set<string>([asset.originalUrl, asset.normalizedUrl]);

  if (asset.preparedPublicUrl || asset.publicUrl) {
    keys.add(asset.preparedPublicUrl || asset.publicUrl || "");
  }

  for (const value of [asset.originalUrl, asset.normalizedUrl, asset.publicUrl, asset.preparedPublicUrl].filter(
    Boolean
  ) as string[]) {
    try {
      const url = new URL(value);
      keys.add(url.href);
      keys.add(url.href.split("#")[0] ?? url.href);
      keys.add(`${url.pathname}${url.search}`);
      keys.add(url.pathname);
      const filename = url.pathname.split("/").filter(Boolean).at(-1);
      if (filename) {
        keys.add(filename);
      }
    } catch {
      // Raw keys were already added.
    }
  }

  return [...keys].filter(Boolean);
}

function isCssAsset(asset: AssetRecord): boolean {
  return Boolean(
    asset.contentType?.toLowerCase().includes("text/css") ||
      getExtension(asset.normalizedUrl) === ".css" ||
      getExtension(asset.originalUrl) === ".css"
  );
}

function isJsAsset(asset: AssetRecord): boolean {
  const contentType = asset.contentType?.toLowerCase() ?? "";
  const extension = getExtension(asset.normalizedUrl) || getExtension(asset.originalUrl);
  return Boolean(
    contentType.includes("javascript") ||
      contentType.includes("ecmascript") ||
      extension === ".js" ||
      extension === ".mjs"
  );
}

function isGltfAsset(asset: AssetRecord): boolean {
  return asset.assetRole === "gltf" || getExtension(asset.normalizedUrl) === ".gltf" || getExtension(asset.originalUrl) === ".gltf";
}

function buildOutputFilename(pageUrl: string): string {
  let host = "snapshot";
  try {
    host = new URL(pageUrl).host || host;
  } catch {
    // Fallback host is good enough for file URLs or malformed sources.
  }

  const now = new Date();
  const timestamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds())
  ].join("-");
  const safeHost = host.replace(/[^a-z0-9.-]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "snapshot";
  return `clone3d-${safeHost}-${timestamp}.html`;
}

function finalizeReport(report: RewriteReport, filename: string, outputSize: number): RewriteReport {
  return {
    ...report,
    finishedAt: Date.now(),
    outputFilename: filename,
    outputSize,
    unresolvedUrls: [...new Set(report.unresolvedUrls)],
    warnings: [...new Set(report.warnings)]
  };
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
