export const CLONE3D_VERSION = "0.1.0";

export const DEFAULT_INLINE_THRESHOLD_BYTES = 50 * 1024;

export const EXTENSION_MESSAGE_TYPES = {
  ping: "clone3d:ping",
  getStatus: "clone3d:getStatus",
  contentReady: "clone3d:contentReady",
  mainWorldEvent: "clone3d:mainWorldEvent",
  startCapture: "START_CAPTURE",
  contentCaptureRequest: "CONTENT_CAPTURE_REQUEST",
  contentCaptureResult: "CONTENT_CAPTURE_RESULT",
  getJobSummary: "GET_JOB_SUMMARY",
  startDownloads: "clone3d:startDownloads",
  resumeDownloads: "clone3d:resumeDownloads",
  cancelDownloads: "clone3d:cancelDownloads",
  getDownloadProgress: "clone3d:getDownloadProgress",
  startUploads: "clone3d:startUploads",
  resumeUploads: "clone3d:resumeUploads",
  cancelUploads: "clone3d:cancelUploads",
  getUploadProgress: "clone3d:getUploadProgress",
  getCurrentHtmlSnapshot: "clone3d:getCurrentHtmlSnapshot",
  generateAppHtml: "clone3d:generateAppHtml",
  getRewriteProgress: "clone3d:getRewriteProgress",
  prepare3dAssets: "clone3d:prepare3dAssets",
  getPrepare3dProgress: "clone3d:getPrepare3dProgress",
  cancelPrepare3d: "clone3d:cancelPrepare3d",
  getLatestJobSummary: "clone3d:getLatestJobSummary"
} as const;

export const MAIN_WORLD_EVENT_TYPE = "CLONE3D_MAIN_EVENT";

export const DEFAULT_DOWNLOAD_CONCURRENCY = 4;
export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_DOWNLOAD_ATTEMPTS = 3;

export const CATBOX_OFFICIAL_API_ENDPOINT = "https://catbox.moe/user/api.php";
export const DEFAULT_CATBOX_UPLOAD_ENDPOINT = CATBOX_OFFICIAL_API_ENDPOINT;
export const DEFAULT_UPLOAD_CONCURRENCY = 24;
export const DEFAULT_UPLOAD_TIMEOUT_MS = 60_000;
export const DEFAULT_MAX_UPLOAD_ATTEMPTS = 3;
export const CATBOX_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
