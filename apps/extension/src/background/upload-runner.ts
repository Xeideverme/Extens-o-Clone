import type { BlobStoreLike, JobStore } from "@clone3d/storage";
import {
  DEFAULT_MAX_UPLOAD_ATTEMPTS,
  DEFAULT_UPLOAD_CONCURRENCY,
  DEFAULT_UPLOAD_TIMEOUT_MS
} from "@clone3d/shared";
import type { AssetRecord, JobRecord, JobSummary } from "@clone3d/shared";
import { buildJobSummary } from "./download-runner";
import { uploadAssetBlob, type UploadOptions } from "./uploader";

export interface UploadRunnerOptions {
  concurrency: number;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
  endpoint: string;
}

export interface UploadRunnerDeps {
  jobStore: JobStore;
  blobStore: BlobStoreLike;
  options?: Partial<UploadRunnerOptions>;
}

const DEFAULT_RUNNER_OPTIONS: UploadRunnerOptions = {
  concurrency: DEFAULT_UPLOAD_CONCURRENCY,
  timeoutMs: DEFAULT_UPLOAD_TIMEOUT_MS,
  maxAttempts: DEFAULT_MAX_UPLOAD_ATTEMPTS,
  retryBaseDelayMs: 750,
  endpoint: ""
};

const ELIGIBLE_STATUSES = new Set(["downloaded", "queued", "uploading", "failed"]);

export async function startAssetUploads(jobId: string | undefined, deps: UploadRunnerDeps): Promise<JobSummary> {
  const prepared = await prepareAssetUploads(jobId, deps);
  if (!prepared.job || prepared.job.status !== "uploading") {
    return prepared;
  }

  await runPreparedAssetUploads(prepared.job.id, deps);
  return buildJobSummary(deps.jobStore, prepared.job.id);
}

export async function prepareAssetUploads(jobId: string | undefined, deps: UploadRunnerDeps): Promise<JobSummary> {
  const job = jobId ? await deps.jobStore.getJob(jobId) : await deps.jobStore.getLatestJob();
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  const allAssets = await deps.jobStore.getAssetsByJob(job.id);
  const eligibleAssets = allAssets.filter(isUploadEligible);

  if (eligibleAssets.length === 0) {
    await finalizeJobWithoutQueue(job.id, deps.jobStore);
    return buildJobSummary(deps.jobStore, job.id);
  }

  await deps.jobStore.setJobStatus(job.id, "uploading");
  await deps.jobStore.bulkUpdateAssets(
    eligibleAssets.map((asset) => asset.id),
    {
      status: "queued",
      lastError: undefined
    }
  );
  await deps.jobStore.updateJobStats(job.id);

  return buildJobSummary(deps.jobStore, job.id);
}

export async function runPreparedAssetUploads(jobId: string, deps: UploadRunnerDeps): Promise<JobSummary> {
  const job = await deps.jobStore.getJob(jobId);
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  const options = normalizeOptions(deps.options);
  const queuedAssets = uniqueAssetsByHash(
    (await deps.jobStore.getAssetsByStatus(job.id, ["queued", "uploading", "failed"]))
      .filter(isUploadEligible)
  );

  await runQueue(queuedAssets, options.concurrency, async (asset) => {
    const currentJob = await deps.jobStore.getJob(job.id);
    if (currentJob?.status === "cancelled") {
      return;
    }

    try {
      await processAsset(asset.id, deps, options);
    } catch (error) {
      await deps.jobStore.updateAsset(asset.id, {
        status: "failed",
        lastError: errorToMessage(error)
      });
      await deps.jobStore.updateJobStats(job.id);
    }
  });

  await finalizeJob(job.id, deps.jobStore);
  return buildJobSummary(deps.jobStore, job.id);
}

export async function markUploadRunFailed(jobId: string, jobStore: JobStore, error: unknown): Promise<void> {
  const job = await jobStore.getJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  const stats = await jobStore.recomputeJobStats(jobId);
  const hasPartialSuccess = stats.uploadedAssets > 0;

  await jobStore.updateJob(jobId, {
    status: hasPartialSuccess ? "partially-uploaded" : "failed",
    stats,
    errors: [
      ...job.errors,
      {
        code: "upload_runner_failed",
        message: error instanceof Error ? error.message : String(error),
        createdAt: Date.now()
      }
    ]
  });
}

async function processAsset(assetId: string, deps: UploadRunnerDeps, options: UploadRunnerOptions): Promise<void> {
  let asset = await deps.jobStore.getAsset(assetId);
  if (!asset || asset.status === "uploaded" || asset.publicUrl) {
    return;
  }

  const existingUploadedAsset = await findUploadedAssetByHash(asset, deps.jobStore);
  if (existingUploadedAsset?.publicUrl) {
    await copyPublicUrlToMatchingAssets(asset, existingUploadedAsset, deps.jobStore);
    await deps.jobStore.updateJobStats(asset.jobId);
    return;
  }

  if (!asset.localBlobId) {
    await deps.jobStore.updateAsset(asset.id, {
      status: "failed",
      lastError: "local_blob_id_missing"
    });
    await deps.jobStore.updateJobStats(asset.jobId);
    return;
  }

  const blob = await deps.blobStore.getBlob(asset.localBlobId);
  if (!blob) {
    await deps.jobStore.updateAsset(asset.id, {
      status: "failed",
      lastError: "local_blob_missing"
    });
    await deps.jobStore.updateJobStats(asset.jobId);
    return;
  }

  const uploadOptions: UploadOptions = {
    endpoint: options.endpoint,
    timeoutMs: options.timeoutMs
  };

  let lastError = "";
  let attemptsThisRun = 0;

  while (attemptsThisRun < options.maxAttempts) {
    const currentJob = await deps.jobStore.getJob(asset.jobId);
    if (currentJob?.status === "cancelled") {
      return;
    }

    attemptsThisRun += 1;
    asset = (await deps.jobStore.updateAsset(asset.id, {
      status: "uploading",
      uploadAttempts: (asset.uploadAttempts ?? 0) + 1,
      lastError: undefined
    })) ?? asset;
    await deps.jobStore.updateJobStats(asset.jobId);

    const result = await uploadAssetBlob(asset, blob, uploadOptions);
    if (result.ok) {
      await persistUploadedAsset(asset, result);
      await deps.jobStore.updateJobStats(asset.jobId);
      return;
    }

    lastError = result.error;
    if (!result.retryable || attemptsThisRun >= options.maxAttempts) {
      break;
    }

    await deps.jobStore.updateAsset(asset.id, {
      status: "queued",
      lastError
    });
    await deps.jobStore.updateJobStats(asset.jobId);
    await sleep(backoffDelay(options.retryBaseDelayMs, attemptsThisRun));
    asset = (await deps.jobStore.getAsset(asset.id)) ?? asset;
  }

  await deps.jobStore.updateAsset(asset.id, {
    status: "failed",
    lastError: lastError || "upload_failed"
  });
  await deps.jobStore.updateJobStats(asset.jobId);

  async function persistUploadedAsset(
    currentAsset: AssetRecord,
    result: Extract<Awaited<ReturnType<typeof uploadAssetBlob>>, { ok: true }>
  ): Promise<void> {
    await updateMatchingAssetsWithUploadResult(currentAsset, deps.jobStore, {
      publicUrl: result.publicUrl,
      objectKey: result.key,
      contentType: result.contentType,
      size: result.size,
      sha256: result.sha256
    });
  }
}

async function findUploadedAssetByHash(asset: AssetRecord, jobStore: JobStore): Promise<AssetRecord | undefined> {
  if (!asset.sha256) {
    return undefined;
  }

  return (await jobStore.getAssetsByJob(asset.jobId)).find(
    (candidate) => candidate.sha256 === asset.sha256 && candidate.publicUrl
  );
}

async function copyPublicUrlToMatchingAssets(
  targetAsset: AssetRecord,
  uploadedAsset: AssetRecord,
  jobStore: JobStore
): Promise<void> {
  await updateMatchingAssetsWithUploadResult(targetAsset, jobStore, {
    publicUrl: uploadedAsset.publicUrl ?? "",
    objectKey: uploadedAsset.objectKey,
    contentType: uploadedAsset.contentType,
    size: uploadedAsset.size,
    sha256: uploadedAsset.sha256
  });
}

async function updateMatchingAssetsWithUploadResult(
  asset: AssetRecord,
  jobStore: JobStore,
  result: {
    publicUrl: string;
    objectKey?: string;
    contentType?: string;
    size?: number;
    sha256?: string;
  }
): Promise<void> {
  const matchingAssets = (await jobStore.getAssetsByJob(asset.jobId)).filter(
    (candidate) => candidate.sha256 === asset.sha256 && candidate.localBlobId
  );

  await Promise.all(
    matchingAssets.map((matchingAsset) =>
      jobStore.updateAsset(matchingAsset.id, {
        status: "uploaded",
        publicUrl: result.publicUrl,
        objectKey: result.objectKey,
        contentType: matchingAsset.contentType ?? result.contentType,
        size: matchingAsset.size ?? result.size,
        sha256: matchingAsset.sha256 ?? result.sha256,
        lastError: undefined
      })
    )
  );
}

async function finalizeJobWithoutQueue(jobId: string, jobStore: JobStore): Promise<void> {
  const job = await jobStore.getJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  await jobStore.updateJobStats(jobId);
  const assets = await jobStore.getAssetsByJob(jobId);
  const uploadableAssets = assets.filter(isUploadableLocalAsset);
  const uploadedAssets = uploadableAssets.filter((asset) => asset.status === "uploaded" || asset.publicUrl);

  if (uploadableAssets.length > 0 && uploadedAssets.length === uploadableAssets.length) {
    await jobStore.setJobStatus(jobId, "uploaded");
  }
}

async function finalizeJob(jobId: string, jobStore: JobStore): Promise<void> {
  const job = await jobStore.getJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  const assets = await jobStore.getAssetsByJob(jobId);
  const uploadableAssets = assets.filter(isUploadableLocalAsset);
  const uploadedAssets = uploadableAssets.filter((asset) => asset.status === "uploaded" || asset.publicUrl);
  const failedUploadableAssets = uploadableAssets.filter((asset) => asset.status === "failed" && !asset.publicUrl);
  const stats = await jobStore.recomputeJobStats(jobId);
  let status: JobRecord["status"] = "uploaded";

  if (uploadableAssets.length === 0) {
    status = "failed";
  } else if (uploadedAssets.length === uploadableAssets.length) {
    status = "uploaded";
  } else if (uploadedAssets.length > 0) {
    status = "partially-uploaded";
  } else if (failedUploadableAssets.length === uploadableAssets.length) {
    status = "failed";
  } else {
    status = "partially-uploaded";
  }

  await jobStore.updateJob(jobId, {
    status,
    stats
  });
}

async function runQueue<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let nextIndex = 0;
  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
    }
  });

  await Promise.all(workers);
}

function isUploadEligible(asset: AssetRecord): boolean {
  return Boolean(
    isUploadableLocalAsset(asset) &&
      ELIGIBLE_STATUSES.has(asset.status) &&
      !asset.publicUrl
  );
}

function isUploadableLocalAsset(asset: AssetRecord): boolean {
  return Boolean(asset.localBlobId && asset.sha256);
}

function normalizeOptions(options: Partial<UploadRunnerOptions> | undefined): UploadRunnerOptions {
  return {
    ...DEFAULT_RUNNER_OPTIONS,
    ...options,
    concurrency: Math.max(1, Math.floor(options?.concurrency ?? DEFAULT_RUNNER_OPTIONS.concurrency)),
    timeoutMs: Math.max(1000, Math.floor(options?.timeoutMs ?? DEFAULT_RUNNER_OPTIONS.timeoutMs)),
    maxAttempts: Math.max(1, Math.floor(options?.maxAttempts ?? DEFAULT_RUNNER_OPTIONS.maxAttempts)),
    retryBaseDelayMs: Math.max(100, Math.floor(options?.retryBaseDelayMs ?? DEFAULT_RUNNER_OPTIONS.retryBaseDelayMs)),
    endpoint: options?.endpoint?.trim() ?? DEFAULT_RUNNER_OPTIONS.endpoint
  };
}

function uniqueAssetsByHash(assets: AssetRecord[]): AssetRecord[] {
  const byHash = new Map<string, AssetRecord>();

  for (const asset of assets) {
    const hash = asset.sha256;
    if (hash && !byHash.has(hash)) {
      byHash.set(hash, asset);
    }
  }

  return [...byHash.values()];
}

function backoffDelay(baseDelayMs: number, attempt: number): number {
  return Math.min(15_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
