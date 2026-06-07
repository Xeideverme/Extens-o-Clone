import { CATBOX_MAX_UPLOAD_BYTES } from "@clone3d/shared";
import type { AssetRecord } from "@clone3d/shared";

export interface UploadOptions {
  endpoint: string;
  timeoutMs: number;
}

export type UploadResult =
  | {
      ok: true;
      assetId: string;
      key: string;
      publicUrl: string;
      contentType: string;
      size: number;
      sha256: string;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
    };

export type UploadBlobToCatboxResult =
  | {
      ok: true;
      publicUrl: string;
      key: string;
      contentType: string;
      size: number;
    }
  | {
      ok: false;
      error: string;
      retryable: boolean;
    };

export async function uploadAssetBlob(
  asset: AssetRecord,
  blob: Blob,
  options: UploadOptions
): Promise<UploadResult> {
  try {
    return await uploadAssetBlobInternal(asset, blob, options);
  } catch (error) {
    return {
      ok: false,
      error: errorToMessage(error),
      retryable: true
    };
  }
}

export async function uploadBlobToCatbox(params: {
  blob: Blob;
  filename: string;
  contentType: string;
  options: UploadOptions;
}): Promise<UploadBlobToCatboxResult> {
  try {
    return await uploadBlobToCatboxInternal(params);
  } catch (error) {
    return {
      ok: false,
      error: errorToMessage(error),
      retryable: true
    };
  }
}

async function uploadAssetBlobInternal(
  asset: AssetRecord,
  blob: Blob,
  options: UploadOptions
): Promise<UploadResult> {
  const endpoint = normalizeEndpoint(options.endpoint);
  if (!endpoint) {
    return {
      ok: false,
      error: "catbox_endpoint_required",
      retryable: false
    };
  }

  if (!asset.sha256) {
    return {
      ok: false,
      error: "asset_sha256_missing",
      retryable: false
    };
  }

  if (blob.size > CATBOX_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "catbox-size-limit-exceeded",
      retryable: false
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: buildCatboxFormData(getUploadFileName(asset), blob),
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });
    const body = (await response.text()).trim();

    if (!response.ok) {
      return {
        ok: false,
        error: body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}`,
        retryable: isRetryableHttpStatus(response.status)
      };
    }

    const publicUrl = parseCatboxUrl(body);
    if (!publicUrl) {
      return {
        ok: false,
        error: body ? `invalid_catbox_response: ${body.slice(0, 160)}` : "invalid_catbox_response",
        retryable: false
      };
    }

    return {
      ok: true,
      assetId: asset.sha256,
      key: getPublicUrlKey(publicUrl),
      publicUrl,
      contentType: asset.contentType || blob.type || "application/octet-stream",
      size: asset.size ?? blob.size,
      sha256: asset.sha256
    };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? `upload timeout after ${options.timeoutMs}ms` : errorToMessage(error),
      retryable: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadBlobToCatboxInternal(params: {
  blob: Blob;
  filename: string;
  contentType: string;
  options: UploadOptions;
}): Promise<UploadBlobToCatboxResult> {
  const endpoint = normalizeEndpoint(params.options.endpoint);
  if (!endpoint) {
    return {
      ok: false,
      error: "catbox_endpoint_required",
      retryable: false
    };
  }

  if (params.blob.size > CATBOX_MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "catbox-size-limit-exceeded",
      retryable: false
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), params.options.timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      body: buildCatboxFormData(params.filename, params.blob),
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });
    const body = (await response.text()).trim();

    if (!response.ok) {
      return {
        ok: false,
        error: body ? `HTTP ${response.status}: ${body}` : `HTTP ${response.status}`,
        retryable: isRetryableHttpStatus(response.status)
      };
    }

    const publicUrl = parseCatboxUrl(body);
    if (!publicUrl) {
      return {
        ok: false,
        error: body ? `invalid_catbox_response: ${body.slice(0, 160)}` : "invalid_catbox_response",
        retryable: false
      };
    }

    return {
      ok: true,
      publicUrl,
      key: getPublicUrlKey(publicUrl),
      contentType: params.contentType || params.blob.type || "application/octet-stream",
      size: params.blob.size
    };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? `upload timeout after ${params.options.timeoutMs}ms` : errorToMessage(error),
      retryable: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

function buildCatboxFormData(fileName: string, blob: Blob): FormData {
  const formData = new FormData();

  formData.append("reqtype", "fileupload");
  formData.append("fileToUpload", blob, fileName);
  return formData;
}

function normalizeEndpoint(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:") {
      return undefined;
    }

    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function getUploadFileName(asset: AssetRecord): string {
  try {
    const pathname = new URL(asset.normalizedUrl).pathname;
    const fileName = pathname.split("/").filter(Boolean).at(-1);
    if (fileName) {
      return fileName;
    }
  } catch {
    // Data and blob URLs do not provide useful upload names.
  }

  return asset.sha256 ? `${asset.sha256}.bin` : "asset.bin";
}

function parseCatboxUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "files.catbox.moe") {
      return undefined;
    }

    return url.href;
  } catch {
    return undefined;
  }
}

function getPublicUrlKey(publicUrl: string): string {
  try {
    return new URL(publicUrl).pathname.replace(/^\/+/, "");
  } catch {
    return publicUrl;
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 500 || status === 502 || status === 503 || status === 504;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
