export type CaptureMode = "basic" | "network" | "3d" | "api-replay" | "deep";

export type JobStatus =
  | "created"
  | "capturing"
  | "discovering-assets"
  | "downloading"
  | "uploading"
  | "rewriting"
  | "generating-output"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobStats {
  discoveredAssets: number;
  downloadedAssets: number;
  uploadedAssets: number;
  failedAssets: number;
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
  discoveredAt: number;
  updatedAt: number;
}

export interface ExtensionMessage<TPayload = unknown> {
  type: string;
  payload?: TPayload;
}

export interface MainWorldEvent {
  kind: "ready";
  pageUrl: string;
  createdAt: number;
}
