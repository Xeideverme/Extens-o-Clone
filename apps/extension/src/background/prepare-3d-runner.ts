import type { BlobStoreLike, JobStore } from "@clone3d/storage";
import {
  buildAssetManifest,
  detect3dAssetRole,
  isDecoderAssetRole,
  isThreeDAssetRole,
  rewriteGltf,
  rewriteWorkerJs
} from "@clone3d/rewriter";
import { DEFAULT_MAX_UPLOAD_ATTEMPTS, DEFAULT_UPLOAD_TIMEOUT_MS, getExtension } from "@clone3d/shared";
import type { AssetRecord, JobRecord, JobSummary, ThreeDPreparationReport } from "@clone3d/shared";
import { buildJobSummary } from "./download-runner";
import { uploadDerivedAssetBlob, type DerivedAssetUploadOptions } from "./derived-asset-uploader";

export interface Prepare3dRunnerOptions {
  endpoint: string;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  force: boolean;
}

export interface Prepare3dRunnerDeps {
  jobStore: JobStore;
  blobStore: BlobStoreLike;
  options?: Partial<Prepare3dRunnerOptions>;
}

const DEFAULT_OPTIONS: Prepare3dRunnerOptions = {
  endpoint: "",
  timeoutMs: DEFAULT_UPLOAD_TIMEOUT_MS,
  maxAttempts: DEFAULT_MAX_UPLOAD_ATTEMPTS,
  retryBaseDelayMs: 750,
  force: false
};

const TEXT_SCRIPT_EXTENSIONS = new Set([".js", ".mjs"]);

export async function prepareThreeDJob(jobId: string | undefined, deps: Prepare3dRunnerDeps): Promise<JobSummary> {
  const job = jobId ? await deps.jobStore.getJob(jobId) : await deps.jobStore.getLatestJob();
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  const assets = await deps.jobStore.getAssetsByJob(job.id);
  const report = createInitialReport(job.id, assets);

  await deps.jobStore.updateJob(job.id, {
    status: "preparing-3d",
    threeDPreparationReport: report
  });
  await deps.jobStore.saveThreeDPreparationReport(report);

  return buildJobSummary(deps.jobStore, job.id);
}

export async function runPreparedThreeDJob(jobId: string, deps: Prepare3dRunnerDeps): Promise<JobSummary> {
  const job = await deps.jobStore.getJob(jobId);
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  const options = normalizeOptions(deps.options);
  await detectAndPersistRoles(job.id, deps.jobStore);
  let assets = await deps.jobStore.getAssetsByJob(job.id);
  let report = await refreshReportCounts(job.id, deps.jobStore);

  const manifestResult = buildAssetManifest(job, assets);
  if (manifestResult.warnings.length > 0) {
    report = await appendReport(job.id, deps.jobStore, { warnings: manifestResult.warnings });
  }

  for (const asset of assets.filter((candidate) => !candidate.isDerivedAsset && candidate.assetRole === "glb")) {
    if (await isCancelled(job.id, deps.jobStore)) {
      return buildJobSummary(deps.jobStore, job.id);
    }

    await prepareGlb(asset, deps.jobStore, options.force);
  }

  assets = await deps.jobStore.getAssetsByJob(job.id);
  for (const asset of assets.filter((candidate) => !candidate.isDerivedAsset && candidate.assetRole === "gltf")) {
    if (await isCancelled(job.id, deps.jobStore)) {
      return buildJobSummary(deps.jobStore, job.id);
    }

    try {
      await prepareGltfAsset(asset, job, assets, deps, options);
    } catch (error) {
      await markAssetPreparationWarning(asset, deps.jobStore, errorToMessage(error));
      report = await appendReport(job.id, deps.jobStore, { errors: [`${asset.normalizedUrl}: ${errorToMessage(error)}`] });
    }
  }

  assets = await deps.jobStore.getAssetsByJob(job.id);
  const nextManifest = buildAssetManifest({ ...job, updatedAt: Date.now() }, assets).manifest;
  for (const asset of assets.filter(isWorkerOrDecoderCandidate)) {
    if (await isCancelled(job.id, deps.jobStore)) {
      return buildJobSummary(deps.jobStore, job.id);
    }

    try {
      await prepareWorkerOrDecoderAsset(asset, nextManifest, deps, options);
    } catch (error) {
      await markAssetPreparationWarning(asset, deps.jobStore, errorToMessage(error));
      report = await appendReport(job.id, deps.jobStore, { errors: [`${asset.normalizedUrl}: ${errorToMessage(error)}`] });
    }
  }

  await finalizePrepare3dJob(job.id, deps.jobStore);
  return buildJobSummary(deps.jobStore, job.id);
}

export async function markPrepare3dRunFailed(jobId: string, jobStore: JobStore, error: unknown): Promise<void> {
  const job = await jobStore.getJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  const report =
    (await appendReport(jobId, jobStore, { errors: [error instanceof Error ? error.message : String(error)] })) ??
    createInitialReport(jobId, []);

  await jobStore.updateJob(jobId, {
    status: "prepare-3d-failed",
    threeDPreparationReport: {
      ...report,
      finishedAt: Date.now()
    },
    errors: [
      ...job.errors,
      {
        code: "prepare_3d_runner_failed",
        message: error instanceof Error ? error.message : String(error),
        createdAt: Date.now()
      }
    ]
  });
}

async function detectAndPersistRoles(jobId: string, jobStore: JobStore): Promise<void> {
  const assets = await jobStore.getAssetsByJob(jobId);

  for (const asset of assets) {
    if (asset.isDerivedAsset) {
      continue;
    }

    const role = detect3dAssetRole(asset);
    const is3d = isThreeDAssetRole(role);
    if (asset.assetRole !== role || asset.is3dAsset !== is3d) {
      await jobStore.updateAsset(asset.id, {
        assetRole: role,
        is3dAsset: is3d
      });
    }
  }
}

async function prepareGltfAsset(
  asset: AssetRecord,
  job: JobRecord,
  allAssets: AssetRecord[],
  deps: Prepare3dRunnerDeps,
  options: Prepare3dRunnerOptions
): Promise<void> {
  if (!options.force && asset.threeDPrepared) {
    return;
  }

  if (!asset.localBlobId) {
    await markAssetPreparationWarning(asset, deps.jobStore, "local_blob_id_missing");
    await appendReport(asset.jobId, deps.jobStore, { unresolvedGltfUris: [asset.normalizedUrl] });
    return;
  }

  const blob = await deps.blobStore.getBlob(asset.localBlobId);
  if (!blob) {
    await markAssetPreparationWarning(asset, deps.jobStore, "local_blob_missing");
    await appendReport(asset.jobId, deps.jobStore, { unresolvedGltfUris: [asset.normalizedUrl] });
    return;
  }

  const gltfText = await blob.text();
  const manifestResult = buildAssetManifest(job, allAssets);
  const output = rewriteGltf({
    gltfAsset: asset,
    gltfText,
    baseUrl: asset.normalizedUrl || job.pageUrl,
    manifest: manifestResult.manifest,
    allAssets
  });

  await appendReport(asset.jobId, deps.jobStore, {
    gltfFilesAnalyzed: 1,
    warnings: [...manifestResult.warnings, ...output.warnings],
    unresolvedGltfUris: output.unresolvedUris
  });

  if (!output.changed) {
    await deps.jobStore.updateAsset(asset.id, {
      contentType: asset.contentType ?? "model/gltf+json",
      threeDPrepared: true,
      threeDPreparationWarnings: output.warnings
    });
    return;
  }

  const derivedBlob = new Blob([output.gltfText], { type: "model/gltf+json" });
  const filename = `${stripKnownExtension(getFilename(asset.normalizedUrl) || "scene")}.clone3d.gltf`;
  const upload = await uploadDerivedAssetBlob({
    blobStore: deps.blobStore,
    blob: derivedBlob,
    filename,
    contentType: "model/gltf+json",
    originalUrl: asset.originalUrl,
    normalizedUrl: asset.normalizedUrl,
    derivedFromAssetId: asset.id,
    derivedKind: "rewritten-gltf",
    options: toDerivedUploadOptions(options)
  });

  await deps.jobStore.updateAsset(asset.id, {
    contentType: "model/gltf+json",
    originalPublicUrl: asset.originalPublicUrl ?? asset.publicUrl,
    publicUrl: upload.publicUrl,
    preparedPublicUrl: upload.publicUrl,
    objectKey: upload.objectKey,
    threeDPrepared: true,
    threeDPreparationWarnings: output.warnings,
    lastError: undefined
  });
  await appendReport(asset.jobId, deps.jobStore, {
    gltfFilesRewritten: 1,
    derivedAssetsCreated: 1,
    derivedAssetsUploaded: 1
  });
}

async function prepareWorkerOrDecoderAsset(
  asset: AssetRecord,
  manifest: ReturnType<typeof buildAssetManifest>["manifest"],
  deps: Prepare3dRunnerDeps,
  options: Prepare3dRunnerOptions
): Promise<void> {
  if (!options.force && asset.threeDPrepared) {
    return;
  }

  if (!asset.localBlobId) {
    await markAssetPreparationWarning(asset, deps.jobStore, "local_blob_id_missing");
    await appendReport(asset.jobId, deps.jobStore, { unresolvedWorkerUrls: [asset.normalizedUrl] });
    return;
  }

  const blob = await deps.blobStore.getBlob(asset.localBlobId);
  if (!blob) {
    await markAssetPreparationWarning(asset, deps.jobStore, "local_blob_missing");
    await appendReport(asset.jobId, deps.jobStore, { unresolvedWorkerUrls: [asset.normalizedUrl] });
    return;
  }

  const text = await blob.text();
  const output = rewriteWorkerJs({
    js: text,
    scriptUrlOrBaseUrl: asset.normalizedUrl,
    manifest,
    injectRuntime: true
  });

  await appendReport(asset.jobId, deps.jobStore, {
    warnings: output.warnings,
    unresolvedWorkerUrls: output.unresolvedUrls
  });

  if (!output.changed) {
    await deps.jobStore.updateAsset(asset.id, {
      threeDPrepared: true,
      threeDPreparationWarnings: output.warnings
    });
    return;
  }

  const contentType = asset.contentType?.includes("javascript") ? asset.contentType : "text/javascript; charset=utf-8";
  const derivedBlob = new Blob([output.js], { type: contentType });
  const filename = buildDerivedScriptFilename(asset);
  const upload = await uploadDerivedAssetBlob({
    blobStore: deps.blobStore,
    blob: derivedBlob,
    filename,
    contentType,
    originalUrl: asset.originalUrl,
    normalizedUrl: asset.normalizedUrl,
    derivedFromAssetId: asset.id,
    derivedKind: isDecoderAssetRole(asset.assetRole) ? "rewritten-decoder-js" : "rewritten-worker",
    options: toDerivedUploadOptions(options)
  });

  await deps.jobStore.updateAsset(asset.id, {
    originalPublicUrl: asset.originalPublicUrl ?? asset.publicUrl,
    publicUrl: upload.publicUrl,
    preparedPublicUrl: upload.publicUrl,
    objectKey: upload.objectKey,
    threeDPrepared: true,
    threeDPreparationWarnings: output.warnings,
    lastError: undefined
  });
  await appendReport(asset.jobId, deps.jobStore, {
    derivedAssetsCreated: 1,
    derivedAssetsUploaded: 1
  });
}

async function prepareGlb(asset: AssetRecord, jobStore: JobStore, force: boolean): Promise<void> {
  if (!force && asset.threeDPrepared) {
    return;
  }

  const warnings: string[] = [];
  if (!asset.publicUrl && !asset.preparedPublicUrl) {
    warnings.push("glb_public_url_missing");
  }

  await jobStore.updateAsset(asset.id, {
    contentType: asset.contentType ?? "model/gltf-binary",
    threeDPrepared: warnings.length === 0,
    threeDPreparationWarnings: warnings
  });
  if (warnings.length > 0) {
    await appendReport(asset.jobId, jobStore, { warnings });
  }
}

async function refreshReportCounts(jobId: string, jobStore: JobStore): Promise<ThreeDPreparationReport> {
  const assets = await jobStore.getAssetsByJob(jobId);
  const report = (await jobStore.getThreeDPreparationReport(jobId)) ?? createInitialReport(jobId, assets);
  const counted = countAssets(assets);
  const updated = {
    ...report,
    ...counted
  };
  await jobStore.saveThreeDPreparationReport(updated);
  return updated;
}

async function appendReport(
  jobId: string,
  jobStore: JobStore,
  patch: Partial<Omit<ThreeDPreparationReport, "jobId" | "startedAt">>
): Promise<ThreeDPreparationReport> {
  const current = (await jobStore.getThreeDPreparationReport(jobId)) ?? createInitialReport(jobId, []);
  const updated: ThreeDPreparationReport = {
    ...current,
    gltfFilesAnalyzed: current.gltfFilesAnalyzed + (patch.gltfFilesAnalyzed ?? 0),
    gltfFilesRewritten: current.gltfFilesRewritten + (patch.gltfFilesRewritten ?? 0),
    derivedAssetsCreated: current.derivedAssetsCreated + (patch.derivedAssetsCreated ?? 0),
    derivedAssetsUploaded: current.derivedAssetsUploaded + (patch.derivedAssetsUploaded ?? 0),
    unresolvedGltfUris: unique([...current.unresolvedGltfUris, ...(patch.unresolvedGltfUris ?? [])]),
    unresolvedDecoderUrls: unique([...current.unresolvedDecoderUrls, ...(patch.unresolvedDecoderUrls ?? [])]),
    unresolvedWorkerUrls: unique([...current.unresolvedWorkerUrls, ...(patch.unresolvedWorkerUrls ?? [])]),
    warnings: unique([...current.warnings, ...(patch.warnings ?? [])]),
    errors: unique([...current.errors, ...(patch.errors ?? [])])
  };
  await jobStore.saveThreeDPreparationReport(updated);
  return updated;
}

async function finalizePrepare3dJob(jobId: string, jobStore: JobStore): Promise<void> {
  const job = await jobStore.getJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  const report = await refreshReportCounts(jobId, jobStore);
  const finalReport = {
    ...report,
    finishedAt: Date.now()
  };
  const hasIssues =
    finalReport.errors.length > 0 ||
    finalReport.unresolvedGltfUris.length > 0 ||
    finalReport.unresolvedDecoderUrls.length > 0 ||
    finalReport.unresolvedWorkerUrls.length > 0;
  const status: JobRecord["status"] =
    finalReport.detected3dAssets === 0
      ? "prepared-3d"
      : finalReport.errors.length > 0 && finalReport.derivedAssetsUploaded === 0
        ? "partially-prepared-3d"
        : hasIssues
          ? "partially-prepared-3d"
          : "prepared-3d";

  await jobStore.saveThreeDPreparationReport(finalReport);
  await jobStore.updateJob(jobId, {
    status,
    threeDPreparationReport: finalReport
  });
}

async function markAssetPreparationWarning(asset: AssetRecord, jobStore: JobStore, warning: string): Promise<void> {
  await jobStore.updateAsset(asset.id, {
    threeDPrepared: false,
    threeDPreparationWarnings: unique([...(asset.threeDPreparationWarnings ?? []), warning]),
    lastError: warning
  });
}

function createInitialReport(jobId: string, assets: AssetRecord[]): ThreeDPreparationReport {
  return {
    jobId,
    startedAt: Date.now(),
    ...countAssets(assets),
    gltfFilesAnalyzed: 0,
    gltfFilesRewritten: 0,
    derivedAssetsCreated: 0,
    derivedAssetsUploaded: 0,
    unresolvedGltfUris: [],
    unresolvedDecoderUrls: [],
    unresolvedWorkerUrls: [],
    warnings: [],
    errors: []
  };
}

function countAssets(assets: AssetRecord[]) {
  const roles = assets
    .filter((asset) => !asset.isDerivedAsset)
    .map((asset) => asset.assetRole ?? detect3dAssetRole(asset));
  return {
    detected3dAssets: roles.filter(isThreeDAssetRole).length,
    decoderAssetsDetected: roles.filter(isDecoderAssetRole).length,
    workerAssetsDetected: roles.filter((role) => role === "worker").length,
    wasmAssetsDetected: roles.filter((role) => role === "wasm").length,
    textureAssetsDetected: roles.filter((role) => role === "texture" || role === "ktx2-texture").length
  };
}

function isWorkerOrDecoderCandidate(asset: AssetRecord): boolean {
  if (asset.isDerivedAsset) {
    return false;
  }

  const extension = getExtension(asset.normalizedUrl) || getExtension(asset.originalUrl);
  const role = asset.assetRole;
  return Boolean(
    role === "worker" ||
      isDecoderAssetRole(role) ||
      (TEXT_SCRIPT_EXTENSIONS.has(extension ?? "") &&
        /worker|decoder|transcoder|draco|basis|meshopt|ktx2|wasm/i.test(`${asset.normalizedUrl} ${asset.originalUrl}`))
  );
}

function buildDerivedScriptFilename(asset: AssetRecord): string {
  const filename = getFilename(asset.normalizedUrl) || getFilename(asset.originalUrl) || "worker.js";
  const basename = stripKnownExtension(filename);
  return isDecoderAssetRole(asset.assetRole) ? `${basename}.clone3d.decoder.js` : `${basename}.clone3d.worker.js`;
}

function toDerivedUploadOptions(options: Prepare3dRunnerOptions): DerivedAssetUploadOptions {
  return {
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    retryBaseDelayMs: options.retryBaseDelayMs
  };
}

function normalizeOptions(options: Partial<Prepare3dRunnerOptions> | undefined): Prepare3dRunnerOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    timeoutMs: Math.max(1000, Math.floor(options?.timeoutMs ?? DEFAULT_OPTIONS.timeoutMs)),
    maxAttempts: Math.max(1, Math.floor(options?.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts)),
    retryBaseDelayMs: Math.max(100, Math.floor(options?.retryBaseDelayMs ?? DEFAULT_OPTIONS.retryBaseDelayMs)),
    endpoint: options?.endpoint?.trim() ?? DEFAULT_OPTIONS.endpoint,
    force: Boolean(options?.force ?? DEFAULT_OPTIONS.force)
  };
}

async function isCancelled(jobId: string, jobStore: JobStore): Promise<boolean> {
  return (await jobStore.getJob(jobId))?.status === "cancelled";
}

function getFilename(value: string): string | undefined {
  try {
    const pathname = new URL(value).pathname;
    return pathname.split("/").filter(Boolean).at(-1);
  } catch {
    return value.split(/[?#]/)[0]?.split("/").filter(Boolean).at(-1);
  }
}

function stripKnownExtension(value: string): string {
  return value.replace(/\.(?:gltf|glb|js|mjs|json)$/i, "");
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
