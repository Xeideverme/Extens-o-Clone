import type { BlobStoreLike, JobStore } from "@clone3d/storage";
import { sha256Blob } from "@clone3d/shared";
import {
  DEFAULT_DOWNLOAD_CONCURRENCY,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_MAX_DOWNLOAD_ATTEMPTS
} from "@clone3d/shared";
import type { AssetRecord, JobRecord, JobSummary } from "@clone3d/shared";
import { downloadAsset, type DownloadOptions } from "./downloader";

export interface DownloadRunnerOptions {
  concurrency: number;
  timeoutMs: number;
  maxAttempts: number;
  retryBaseDelayMs: number;
}

export interface DownloadRunnerDeps {
  jobStore: JobStore;
  blobStore: BlobStoreLike;
  options?: Partial<DownloadRunnerOptions>;
}

const DEFAULT_RUNNER_OPTIONS: DownloadRunnerOptions = {
  concurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
  timeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
  maxAttempts: DEFAULT_MAX_DOWNLOAD_ATTEMPTS,
  retryBaseDelayMs: 500
};

const ELIGIBLE_STATUSES = new Set(["discovered", "queued", "downloading", "failed"]);

export async function startAssetDownloads(jobId: string | undefined, deps: DownloadRunnerDeps): Promise<JobSummary> {
  const job = jobId ? await deps.jobStore.getJob(jobId) : await deps.jobStore.getLatestJob();
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  const options = normalizeOptions(deps.options);
  await deps.jobStore.setJobStatus(job.id, "downloading");

  const allAssets = await deps.jobStore.getAssetsByJob(job.id);
  const eligibleAssets = allAssets.filter((asset) => ELIGIBLE_STATUSES.has(asset.status));

  await deps.jobStore.bulkUpdateAssets(
    eligibleAssets.map((asset) => asset.id),
    {
      status: "queued",
      lastError: undefined,
      skippedReason: undefined
    }
  );
  await deps.jobStore.updateJobStats(job.id);

  await runQueue(eligibleAssets, options.concurrency, async (asset) => {
    const currentJob = await deps.jobStore.getJob(job.id);
    if (currentJob?.status === "cancelled") {
      return;
    }

    await processAsset(asset.id, deps, options);
  });

  await finalizeJob(job.id, deps.jobStore);
  return buildJobSummary(deps.jobStore, job.id);
}

export async function buildJobSummary(jobStore: JobStore, jobId?: string): Promise<JobSummary> {
  const job = jobId ? await jobStore.getJob(jobId) : await jobStore.getLatestJob();
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  const assets = await jobStore.getAssetsByJob(job.id);

  return {
    job,
    assets: assets.sort((a, b) => a.normalizedUrl.localeCompare(b.normalizedUrl)),
    domains: collectDomains(assets)
  };
}

async function processAsset(assetId: string, deps: DownloadRunnerDeps, options: DownloadRunnerOptions): Promise<void> {
  let asset = await deps.jobStore.getAsset(assetId);
  if (!asset || asset.status === "downloaded" || asset.status === "skipped") {
    return;
  }

  const downloadOptions: DownloadOptions = {
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    retryBaseDelayMs: options.retryBaseDelayMs
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
      status: "downloading",
      downloadAttempts: (asset.downloadAttempts ?? 0) + 1,
      lastError: undefined,
      skippedReason: undefined
    })) ?? asset;
    await deps.jobStore.updateJobStats(asset.jobId);

    const result = await downloadAsset(asset, downloadOptions);
    if (result.ok) {
      await persistDownloadedAsset(asset, result.blob, result.contentType, deps);
      return;
    }

    if (result.skipped) {
      await deps.jobStore.updateAsset(asset.id, {
        status: "skipped",
        skippedReason: result.skippedReason ?? result.error,
        lastError: undefined
      });
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
    lastError: lastError || "download-failed"
  });
  await deps.jobStore.updateJobStats(asset.jobId);
}

async function persistDownloadedAsset(
  asset: AssetRecord,
  blob: Blob,
  contentType: string,
  deps: DownloadRunnerDeps
): Promise<void> {
  const sha256 = await sha256Blob(blob);
  const existing = await deps.blobStore.getBlobRecordByHash(sha256);
  const blobRecord =
    existing ??
    (await deps.blobStore.putBlob({
      blob,
      sha256,
      contentType,
      originalUrl: asset.originalUrl,
      normalizedUrl: asset.normalizedUrl
    }));

  await deps.jobStore.updateAsset(asset.id, {
    status: "downloaded",
    contentType: blobRecord.contentType || contentType,
    size: blobRecord.size || blob.size,
    sha256,
    localBlobId: blobRecord.blobId,
    lastError: undefined,
    skippedReason: undefined
  });
  await deps.jobStore.updateJobStats(asset.jobId);
}

async function finalizeJob(jobId: string, jobStore: JobStore): Promise<void> {
  const job = await jobStore.getJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  const stats = await jobStore.recomputeJobStats(jobId);
  const terminalAssets = stats.downloadedAssets + stats.skippedAssets + stats.failedAssets;
  let status: JobRecord["status"] = "downloaded";

  if (stats.failedAssets > 0 && stats.downloadedAssets + stats.skippedAssets > 0) {
    status = "partially-downloaded";
  } else if (stats.failedAssets > 0 && stats.downloadedAssets + stats.skippedAssets === 0) {
    status = "failed";
  } else if (terminalAssets < stats.totalAssets) {
    status = "partially-downloaded";
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

function normalizeOptions(options: Partial<DownloadRunnerOptions> | undefined): DownloadRunnerOptions {
  return {
    ...DEFAULT_RUNNER_OPTIONS,
    ...options,
    concurrency: Math.max(1, Math.floor(options?.concurrency ?? DEFAULT_RUNNER_OPTIONS.concurrency)),
    timeoutMs: Math.max(1000, Math.floor(options?.timeoutMs ?? DEFAULT_RUNNER_OPTIONS.timeoutMs)),
    maxAttempts: Math.max(1, Math.floor(options?.maxAttempts ?? DEFAULT_RUNNER_OPTIONS.maxAttempts)),
    retryBaseDelayMs: Math.max(100, Math.floor(options?.retryBaseDelayMs ?? DEFAULT_RUNNER_OPTIONS.retryBaseDelayMs))
  };
}

function backoffDelay(baseDelayMs: number, attempt: number): number {
  return Math.min(10_000, baseDelayMs * 2 ** Math.max(0, attempt - 1));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function collectDomains(assets: AssetRecord[]): string[] {
  const domains = new Set<string>();

  for (const asset of assets) {
    try {
      domains.add(new URL(asset.normalizedUrl).host);
    } catch {
      // Non-standard URL kinds are expected for data/blob entries.
    }
  }

  return [...domains].sort();
}
