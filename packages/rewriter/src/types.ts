import type {
  AssetManifest,
  AssetRecord,
  HtmlSnapshotRecord,
  JobRecord,
  RewriteReport
} from "@clone3d/shared";

export interface BuildAssetManifestResult {
  manifest: AssetManifest;
  warnings: string[];
}

export interface RewriteCssInput {
  css: string;
  cssUrlOrBaseUrl: string;
  manifest: AssetManifest;
}

export interface RewriteCssOutput {
  css: string;
  rewrites: number;
  unresolvedUrls: string[];
  warnings: string[];
}

export interface RewriteJsInput {
  js: string;
  scriptUrlOrBaseUrl: string;
  manifest: AssetManifest;
}

export interface RewriteJsOutput {
  js: string;
  directRewrites: number;
  unresolvedCandidates: string[];
  warnings: string[];
}

export interface InlineResponse {
  status: number;
  contentType: string;
  bodyText: string;
}

export interface RewriteHtmlInput {
  html: string;
  doctype?: string;
  pageUrl: string;
  baseUrl: string;
  manifest: AssetManifest;
  cssByUrl: Map<string, string>;
  jsByUrl: Map<string, string>;
  inlineResponses: Record<string, InlineResponse>;
  inlineThresholdBytes: number;
  runtimeScript: string;
  manifestScript: string;
  reportScript?: string;
}

export interface RewriteHtmlOutput {
  html: string;
  htmlRewrites: number;
  cssRewrites: number;
  jsDirectRewrites: number;
  jsonInlined: number;
  warnings: string[];
  unresolvedUrls: string[];
}

export interface TextAssetRecord {
  asset: AssetRecord;
  text: string;
}

export interface GenerateAppHtmlInput {
  job: JobRecord;
  assets: AssetRecord[];
  htmlSnapshot: HtmlSnapshotRecord;
  textAssets: TextAssetRecord[];
  inlineThresholdBytes: number;
  runtimeResolverEnabled: boolean;
  includeRewriteReportInHtml: boolean;
}

export interface GenerateAppHtmlOutput {
  html: string;
  report: RewriteReport;
  filename: string;
}
