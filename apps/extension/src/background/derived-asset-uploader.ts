import type { BlobStoreLike } from "@clone3d/storage";
import { sha256Blob } from "@clone3d/shared";
import type { BlobRecord, DerivedAssetKind } from "@clone3d/shared";
import { uploadBlobToCatbox, type UploadOptions } from "./uploader";

export interface DerivedAssetUploadOptions extends UploadOptions {
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export interface DerivedAssetUploadResult {
  ok: true;
  blobRecord: BlobRecord;
  publicUrl: string;
  objectKey: string;
  sha256: string;
  size: number;
  contentType: string;
}

export async function uploadDerivedAssetBlob(params: {
  blobStore: BlobStoreLike;
  blob: Blob;
  filename: string;
  contentType: string;
  originalUrl?: string;
  normalizedUrl?: string;
  derivedFromAssetId: string;
  derivedKind: DerivedAssetKind;
  options: DerivedAssetUploadOptions;
}): Promise<DerivedAssetUploadResult> {
  const sha256 = await sha256Blob(params.blob);
  const blobRecord = await params.blobStore.putBlob({
    blob: params.blob,
    sha256,
    contentType: params.contentType,
    originalUrl: params.originalUrl,
    normalizedUrl: params.normalizedUrl,
    derivedFromAssetId: params.derivedFromAssetId,
    derivedKind: params.derivedKind,
    filename: params.filename
  });

  let lastError = "";
  for (let attempt = 1; attempt <= params.options.maxAttempts; attempt += 1) {
    const result = await uploadBlobToCatbox({
      blob: params.blob,
      filename: params.filename,
      contentType: params.contentType,
      options: {
        endpoint: params.options.endpoint,
        timeoutMs: params.options.timeoutMs
      }
    });

    if (result.ok) {
      return {
        ok: true,
        blobRecord,
        publicUrl: result.publicUrl,
        objectKey: result.key,
        sha256,
        size: result.size,
        contentType: result.contentType
      };
    }

    lastError = result.error;
    if (!result.retryable || attempt >= params.options.maxAttempts) {
      break;
    }

    await sleep(backoffDelay(params.options.retryBaseDelayMs, attempt));
  }

  throw new Error(lastError || "derived_asset_upload_failed");
}

function backoffDelay(baseDelayMs: number, attempt: number): number {
  return Math.min(15_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
