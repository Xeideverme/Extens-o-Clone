import { createRewriteReport, generateAppHtml, type TextAssetRecord } from "@clone3d/rewriter";
import type { BlobStoreLike, JobStore } from "@clone3d/storage";
import { sha256Blob } from "@clone3d/shared";
import type {
  AssetRecord,
  CurrentHtmlSnapshotResponse,
  GeneratedOutputRecord,
  HtmlSnapshotRecord,
  JobSummary,
  RewriteReport
} from "@clone3d/shared";
import { EXTENSION_MESSAGE_TYPES, getExtension } from "@clone3d/shared";
import { buildJobSummary } from "./download-runner";
import { downloadGeneratedHtml } from "./output-downloader";
import type { ExtensionSettings } from "../shared/settings-store";

export interface RewriteRunnerDeps {
  jobStore: JobStore;
  blobStore: BlobStoreLike;
  settings: ExtensionSettings;
}

export async function prepareRewriteJob(jobId: string | undefined, deps: RewriteRunnerDeps): Promise<JobSummary> {
  const job = jobId ? await deps.jobStore.getJob(jobId) : await deps.jobStore.getLatestJob();
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  await deps.jobStore.setJobStatus(job.id, "rewriting");
  return buildJobSummary(deps.jobStore, job.id);
}

export async function runPreparedRewriteJob(jobId: string, deps: RewriteRunnerDeps): Promise<JobSummary> {
  const job = await deps.jobStore.getJob(jobId);
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  let report: RewriteReport = createRewriteReport(job.id);

  try {
    const assets = await deps.jobStore.getAssetsByJob(job.id);
    const uploadedAssets = assets.filter((asset) => asset.publicUrl);
    if (uploadedAssets.length === 0) {
      throw new Error("No uploaded assets with publicUrl are available.");
    }

    const htmlSnapshot = await getHtmlSnapshot(job.id, deps.jobStore, job.tabId);
    const textAssets = await loadTextAssets(assets, deps.blobStore);
    const generated = generateAppHtml({
      job,
      assets,
      htmlSnapshot,
      textAssets,
      inlineThresholdBytes: deps.settings.inlineThresholdKb * 1024,
      runtimeResolverEnabled: deps.settings.runtimeResolverEnabled,
      includeRewriteReportInHtml: deps.settings.includeRewriteReportInHtml
    });
    report = generated.report;
    const htmlBlob = new Blob([generated.html], { type: "text/html;charset=utf-8" });
    const sha256 = await sha256Blob(htmlBlob);
    const blobRecord = await deps.blobStore.putBlob({
      blob: htmlBlob,
      sha256,
      contentType: "text/html;charset=utf-8",
      originalUrl: generated.filename,
      normalizedUrl: generated.filename
    });
    const output: GeneratedOutputRecord = {
      id: `output:${job.id}:${Date.now().toString(36)}`,
      jobId: job.id,
      type: "app-html",
      filename: generated.filename,
      size: htmlBlob.size,
      blobId: blobRecord.blobId,
      createdAt: Date.now(),
      rewriteReport: report
    };

    await deps.jobStore.putGeneratedOutput(output);
    await downloadGeneratedHtml(generated.filename, generated.html, deps.settings.generateHtmlSaveAs);
    await deps.jobStore.updateJob(job.id, {
      status: "rewritten",
      output: {
        fileName: generated.filename,
        filename: generated.filename,
        type: "app-html",
        size: htmlBlob.size,
        createdAt: output.createdAt,
        rewriteReport: report
      },
      rewriteReport: report
    });

    return buildJobSummary(deps.jobStore, job.id);
  } catch (error) {
    report = {
      ...report,
      finishedAt: Date.now(),
      warnings: [...report.warnings, errorToMessage(error)]
    };
    await deps.jobStore.updateJob(job.id, {
      status: "rewrite-failed",
      rewriteReport: report,
      errors: [
        ...job.errors,
        {
          code: "rewrite_failed",
          message: errorToMessage(error),
          createdAt: Date.now()
        }
      ]
    });

    return buildJobSummary(deps.jobStore, job.id);
  }
}

export async function markRewriteRunFailed(jobId: string, jobStore: JobStore, error: unknown): Promise<void> {
  const job = await jobStore.getJob(jobId);
  if (!job || job.status === "cancelled") {
    return;
  }

  const report = {
    ...(job.rewriteReport ?? createRewriteReport(job.id)),
    finishedAt: Date.now(),
    warnings: [...(job.rewriteReport?.warnings ?? []), errorToMessage(error)]
  };

  await jobStore.updateJob(job.id, {
    status: "rewrite-failed",
    rewriteReport: report,
    errors: [
      ...job.errors,
      {
        code: "rewrite_runner_failed",
        message: errorToMessage(error),
        createdAt: Date.now()
      }
    ]
  });
}

async function getHtmlSnapshot(jobId: string, jobStore: JobStore, tabId: number): Promise<HtmlSnapshotRecord> {
  const persisted = await jobStore.getHtmlSnapshot(jobId);
  if (persisted) {
    return persisted;
  }

  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      type: EXTENSION_MESSAGE_TYPES.getCurrentHtmlSnapshot,
      payload: {
        jobId
      }
    });
    const snapshot = response?.snapshot as CurrentHtmlSnapshotResponse | undefined;
    if (!response?.ok || !snapshot?.html) {
      throw new Error("Current tab did not return an HTML snapshot.");
    }

    const record: HtmlSnapshotRecord = {
      id: `html:${jobId}`,
      jobId,
      html: snapshot.html,
      doctype: snapshot.doctype,
      pageUrl: snapshot.documentUrl,
      baseUrl: snapshot.baseUrl,
      title: snapshot.title,
      capturedAt: snapshot.capturedAt
    };
    await jobStore.putHtmlSnapshot(record);
    return record;
  } catch {
    throw new Error("No persisted HTML snapshot and source tab is unavailable.");
  }
}

async function loadTextAssets(assets: AssetRecord[], blobStore: BlobStoreLike): Promise<TextAssetRecord[]> {
  const textAssets: TextAssetRecord[] = [];

  for (const asset of assets) {
    if (!asset.localBlobId || !isTextAsset(asset)) {
      continue;
    }

    const blob = await blobStore.getBlob(asset.localBlobId);
    if (!blob) {
      continue;
    }

    try {
      textAssets.push({
        asset,
        text: await blob.text()
      });
    } catch {
      // Binary or unreadable text assets should not abort generation.
    }
  }

  return textAssets;
}

function isTextAsset(asset: AssetRecord): boolean {
  const contentType = asset.contentType?.toLowerCase() ?? "";
  const extension = getExtension(asset.normalizedUrl) || getExtension(asset.originalUrl);

  return (
    contentType.startsWith("text/") ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    extension === ".css" ||
    extension === ".js" ||
    extension === ".mjs" ||
    extension === ".json"
  );
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
