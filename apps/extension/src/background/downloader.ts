import { inferContentType, isDownloadableAssetUrl } from "@clone3d/shared";
import type { AssetRecord } from "@clone3d/shared";

export interface DownloadOptions {
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export type DownloadResult =
  | {
      ok: true;
      blob: Blob;
      contentType: string;
      size: number;
    }
  | {
      ok: false;
      error: string;
      skipped?: boolean;
      skippedReason?: string;
      retryable?: boolean;
    };

export async function downloadAsset(asset: AssetRecord, options: DownloadOptions): Promise<DownloadResult> {
  try {
    return await downloadAssetInternal(asset, options);
  } catch (error) {
    return {
      ok: false,
      error: errorToMessage(error),
      retryable: true
    };
  }
}

async function downloadAssetInternal(asset: AssetRecord, options: DownloadOptions): Promise<DownloadResult> {
  const urlCheck = isDownloadableAssetUrl(asset.normalizedUrl);
  if (!urlCheck.downloadable) {
    return {
      ok: false,
      error: urlCheck.reason ?? "url-not-downloadable",
      skipped: true,
      skippedReason: urlCheck.reason ?? "url-not-downloadable",
      retryable: false
    };
  }

  if (urlCheck.protocol === "data:") {
    return decodeDataUrl(asset.normalizedUrl);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(asset.normalizedUrl, {
      method: "GET",
      credentials: "include",
      cache: "default",
      redirect: "follow",
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        retryable: isRetryableHttpStatus(response.status)
      };
    }

    const blob = await response.blob();
    const contentType =
      normalizeContentType(response.headers.get("content-type")) ||
      normalizeContentType(blob.type) ||
      inferContentType(asset.normalizedUrl);

    return {
      ok: true,
      blob,
      contentType,
      size: blob.size
    };
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      error: isAbort ? `timeout after ${options.timeoutMs}ms` : errorToMessage(error),
      retryable: true
    };
  } finally {
    clearTimeout(timeout);
  }
}

function decodeDataUrl(value: string): DownloadResult {
  try {
    const match = value.match(/^data:([^,]*?),(.*)$/s);
    if (!match) {
      return {
        ok: false,
        error: "invalid-data-url",
        skipped: true,
        skippedReason: "invalid-data-url",
        retryable: false
      };
    }

    const meta = match[1] || "text/plain;charset=US-ASCII";
    const body = match[2] || "";
    const isBase64 = /(?:^|;)base64(?:;|$)/i.test(meta);
    const contentType = normalizeContentType(meta.replace(/;base64$/i, "")) || "text/plain;charset=US-ASCII";
    const bytes = isBase64 ? base64ToBytes(body) : percentEncodedToBytes(body);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const blob = new Blob([buffer], { type: contentType });

    return {
      ok: true,
      blob,
      contentType,
      size: blob.size
    };
  } catch (error) {
    return {
      ok: false,
      error: `invalid-data-url: ${errorToMessage(error)}`,
      skipped: true,
      skippedReason: "invalid-data-url",
      retryable: false
    };
  }
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function normalizeContentType(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function base64ToBytes(value: string): Uint8Array {
  try {
    const binary = atob(value);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch (error) {
    throw new Error(`invalid-base64: ${errorToMessage(error)}`);
  }
}

function percentEncodedToBytes(value: string): Uint8Array {
  try {
    const decoded = decodeURIComponent(value.replace(/\+/g, "%20"));
    return new TextEncoder().encode(decoded);
  } catch (error) {
    throw new Error(`invalid-percent-encoding: ${errorToMessage(error)}`);
  }
}
