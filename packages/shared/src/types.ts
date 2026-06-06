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
  | "rewriting"
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
}

export interface JobError {
  code: string;
  message: string;
  createdAt: number;
}

export interface OutputRecord {
  fileName: string;
  createdAt: number;
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
  contentType?: string;
  detectedExtension?: string;
  size?: number;
  sha256?: string;
  etag?: string;
  shouldInline: boolean;
  is3dAsset: boolean;
  isApiResponse: boolean;
  isGeneratedBlob: boolean;
  localBlobId?: string;
  error?: string;
  lastError?: string;
  skippedReason?: string;
  downloadAttempts?: number;
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
  createdAt: number;
  updatedAt: number;
}

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
  kind: "boot" | "fetch" | "xhr-open" | "worker" | "image-src";
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

export interface JobSummary {
  job?: JobRecord;
  assets: AssetRecord[];
  domains: string[];
}
