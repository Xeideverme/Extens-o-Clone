export type CaptureMode = "basic" | "network" | "3d" | "api-replay" | "deep";

export type JobStatus =
  | "created"
  | "capturing"
  | "captured"
  | "discovering-assets"
  | "downloading"
  | "downloaded"
  | "partially-downloaded"
  | "uploading"
  | "uploaded"
  | "partially-uploaded"
  | "preparing-3d"
  | "prepared-3d"
  | "partially-prepared-3d"
  | "prepare-3d-failed"
  | "rewriting"
  | "rewritten"
  | "rewrite-failed"
  | "generating-output"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobStats {
  totalAssets: number;
  queuedAssets: number;
  downloadingAssets: number;
  discoveredAssets: number;
  downloadedAssets: number;
  failedAssets: number;
  skippedAssets: number;
  totalBytes: number;
  downloadedBytes: number;
  uploadedAssets: number;
  totalUploadedBytes: number;
}

export interface JobError {
  code: string;
  message: string;
  createdAt: number;
}

export interface OutputRecord {
  fileName: string;
  filename?: string;
  size?: number;
  type?: "app-html";
  createdAt: number;
  rewriteReport?: RewriteReport;
  threeDPreparationReport?: ThreeDPreparationReport;
}

export interface JobRecord {
  id: string;
  tabId: number;
  frameIds: number[];
  pageUrl: string;
  pageTitle?: string;
  createdAt: number;
  updatedAt: number;
  status: JobStatus;
  mode: CaptureMode;
  stats: JobStats;
  errors: JobError[];
  output?: OutputRecord;
  rewriteReport?: RewriteReport;
  threeDPreparationReport?: ThreeDPreparationReport;
}

export type AssetSource =
  | "dom"
  | "css"
  | "html"
  | "script"
  | "performance"
  | "webRequest"
  | "fetch-hook"
  | "xhr-hook"
  | "image-hook"
  | "worker-hook"
  | "blob-hook"
  | "api-snapshot"
  | "gltf-dependency"
  | "manual";

export type AssetStatus =
  | "discovered"
  | "queued"
  | "downloading"
  | "downloaded"
  | "hashing"
  | "uploading"
  | "uploaded"
  | "inlined"
  | "rewritten"
  | "skipped"
  | "failed";

export interface AssetRecord {
  id: string;
  jobId: string;
  originalUrl: string;
  normalizedUrl: string;
  finalUrl?: string;
  publicUrl?: string;
  objectKey?: string;
  referrerUrl?: string;
  frameUrl?: string;
  source: AssetSource[];
  status: AssetStatus;
  assetRole?: AssetRole;
  contentType?: string;
  detectedExtension?: string;
  size?: number;
  sha256?: string;
  etag?: string;
  shouldInline: boolean;
  is3dAsset: boolean;
  isApiResponse: boolean;
  isGeneratedBlob: boolean;
  isDerivedAsset?: boolean;
  derivedFromAssetId?: string;
  derivedKind?: DerivedAssetKind;
  localBlobId?: string;
  originalPublicUrl?: string;
  preparedPublicUrl?: string;
  threeDPrepared?: boolean;
  threeDPreparationWarnings?: string[];
  error?: string;
  lastError?: string;
  skippedReason?: string;
  downloadAttempts?: number;
  uploadAttempts?: number;
  createdAt?: number;
  discoveredAt: number;
  updatedAt: number;
}

export interface BlobRecord {
  blobId: string;
  sha256: string;
  size: number;
  contentType: string;
  originalUrl?: string;
  normalizedUrl?: string;
  derivedFromAssetId?: string;
  derivedKind?: DerivedAssetKind;
  filename?: string;
  createdAt: number;
  updatedAt: number;
}

export type AssetRole =
  | "html"
  | "css"
  | "script"
  | "json"
  | "image"
  | "audio"
  | "video"
  | "gltf"
  | "glb"
  | "gltf-buffer"
  | "texture"
  | "ktx2-texture"
  | "draco-compressed"
  | "draco-decoder"
  | "basis-transcoder"
  | "meshopt-decoder"
  | "wasm"
  | "worker"
  | "model-viewer"
  | "unknown";

export type DerivedAssetKind =
  | "rewritten-gltf"
  | "rewritten-worker"
  | "rewritten-decoder-js"
  | "rewritten-json"
  | "runtime-injected-worker";

export interface ExtensionMessage<TPayload = unknown> {
  type: string;
  payload?: TPayload;
}

export interface AssetDiscovery {
  rawUrl: string;
  normalizedUrl: string;
  source: AssetSource[];
  referrerUrl?: string;
  frameUrl?: string;
  element?: string;
  attribute?: string;
  initiatorType?: string;
  discoveredAt: number;
}

export interface MainWorldEvent {
  kind: "boot" | "fetch" | "xhr-open" | "worker" | "image-src" | "wasm-streaming";
  pageUrl: string;
  url?: string;
  method?: string;
  createdAt: number;
}

export interface ContentCaptureRequest {
  jobId: string;
  mode: CaptureMode;
}

export interface ContentCaptureResult {
  jobId: string;
  pageUrl: string;
  pageTitle?: string;
  frameUrl: string;
  assets: AssetDiscovery[];
  mainWorldEvents: MainWorldEvent[];
  htmlSnapshot?: CurrentHtmlSnapshotResponse;
  capturedAt: number;
}

export interface StartCaptureRequest {
  mode?: CaptureMode;
  tabId?: number;
}

export interface GetJobSummaryRequest {
  jobId?: string;
}

export interface StartDownloadsRequest {
  jobId?: string;
}

export interface GetDownloadProgressRequest {
  jobId?: string;
}

export interface ResumeDownloadsRequest {
  jobId?: string;
}

export interface CancelDownloadsRequest {
  jobId: string;
}

export interface StartUploadsRequest {
  jobId?: string;
}

export interface ResumeUploadsRequest {
  jobId?: string;
}

export interface GetUploadProgressRequest {
  jobId?: string;
}

export interface CancelUploadsRequest {
  jobId: string;
}

export interface GenerateAppHtmlRequest {
  jobId?: string;
}

export interface Prepare3dAssetsRequest {
  jobId?: string;
  force?: boolean;
}

export interface GetPrepare3dProgressRequest {
  jobId?: string;
}

export interface CancelPrepare3dRequest {
  jobId: string;
}

export interface GetRewriteProgressRequest {
  jobId?: string;
}

export interface CurrentHtmlSnapshotRequest {
  jobId?: string;
}

export interface HtmlSnapshotRecord {
  id: string;
  jobId: string;
  html: string;
  doctype: string;
  pageUrl: string;
  baseUrl: string;
  title?: string;
  capturedAt: number;
}

export interface CurrentHtmlSnapshotResponse {
  html: string;
  doctype: string;
  documentUrl: string;
  baseUrl: string;
  title?: string;
  capturedAt: number;
}

export interface AssetManifestEntry {
  assetId: string;
  originalUrl: string;
  normalizedUrl: string;
  publicUrl: string;
  contentType?: string;
  detectedExtension?: string;
  size?: number;
  sha256?: string;
  source?: AssetSource[];
}

export interface AssetManifest {
  jobId: string;
  pageUrl: string;
  createdAt: number;
  entries: AssetManifestEntry[];
  map: Record<string, string>;
}

export interface RewriteReport {
  jobId: string;
  startedAt: number;
  finishedAt?: number;
  htmlRewrites: number;
  cssRewrites: number;
  jsDirectRewrites: number;
  jsonInlined: number;
  assetsInManifest: number;
  unresolvedUrls: string[];
  warnings: string[];
  outputFilename?: string;
  outputSize?: number;
}

export interface GeneratedOutputRecord {
  id: string;
  jobId: string;
  type: "app-html";
  filename: string;
  size: number;
  blobId?: string;
  createdAt: number;
  rewriteReport: RewriteReport;
}

export interface ThreeDPreparationReport {
  jobId: string;
  startedAt: number;
  finishedAt?: number;
  detected3dAssets: number;
  gltfFilesAnalyzed: number;
  gltfFilesRewritten: number;
  derivedAssetsCreated: number;
  derivedAssetsUploaded: number;
  decoderAssetsDetected: number;
  workerAssetsDetected: number;
  wasmAssetsDetected: number;
  textureAssetsDetected: number;
  unresolvedGltfUris: string[];
  unresolvedDecoderUrls: string[];
  unresolvedWorkerUrls: string[];
  warnings: string[];
  errors: string[];
}

export interface JobSummary {
  job?: JobRecord;
  assets: AssetRecord[];
  domains: string[];
}
