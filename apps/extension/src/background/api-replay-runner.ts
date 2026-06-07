import type { JobStore } from "@clone3d/storage";
import {
  buildApiReplayMap,
  createApiReplayReport,
  rewriteApiSnapshotBody
} from "@clone3d/rewriter";
import { buildAssetManifest } from "@clone3d/rewriter";
import type { ApiReplayReport, ApiSnapshotRecord, JobSummary } from "@clone3d/shared";
import { buildJobSummary } from "./download-runner";

export interface ApiReplayRunnerDeps {
  jobStore: JobStore;
}

export async function prepareApiReplaySnapshots(jobId: string | undefined, deps: ApiReplayRunnerDeps): Promise<JobSummary> {
  const job = jobId ? await deps.jobStore.getJob(jobId) : await deps.jobStore.getLatestJob();
  if (!job) {
    return {
      assets: [],
      domains: []
    };
  }

  const assets = await deps.jobStore.getAssetsByJob(job.id);
  const snapshots = await deps.jobStore.getApiSnapshotsByJob(job.id);
  const manifestResult = buildAssetManifest(job, assets);
  const report = (await deps.jobStore.getApiReplayReport(job.id)) ?? createApiReplayReport(job.id);
  let rewrittenResponses = 0;
  const warnings = [...report.warnings, ...manifestResult.warnings];
  const errors = [...report.errors];

  for (const snapshot of snapshots) {
    if (snapshot.status === "skipped" || snapshot.status === "failed" || !snapshot.bodyText) {
      continue;
    }

    try {
      const output = rewriteApiSnapshotBody({
        bodyText: snapshot.bodyText,
        contentType: snapshot.contentType,
        url: snapshot.normalizedUrl,
        manifest: manifestResult.manifest
      });

      if (output.changed || !snapshot.rewritten) {
        rewrittenResponses += 1;
      }

      warnings.push(...output.warnings);
      await deps.jobStore.updateApiSnapshot(snapshot.id, {
        bodyText: output.bodyText,
        status: "rewritten",
        replayable: true,
        rewritten: true,
        lastError: undefined
      });
    } catch (error) {
      errors.push(errorToMessage(error));
      await deps.jobStore.updateApiSnapshot(snapshot.id, {
        status: "failed",
        replayable: false,
        lastError: errorToMessage(error)
      });
    }
  }

  const preparedSnapshots = await deps.jobStore.getApiSnapshotsByJob(job.id);
  const replayMap = buildApiReplayMap(preparedSnapshots, manifestResult.manifest);
  const nextReport: ApiReplayReport = {
    ...report,
    finishedAt: Date.now(),
    capturedResponses: preparedSnapshots.filter((snapshot) => snapshot.status !== "skipped").length,
    storedResponses: preparedSnapshots.filter((snapshot) => snapshot.bodyText || snapshot.bodyBlobId).length,
    rewrittenResponses:
      preparedSnapshots.filter((snapshot) => snapshot.rewritten).length || report.rewrittenResponses + rewrittenResponses,
    inlinedResponses: preparedSnapshots.filter((snapshot) => snapshot.replayable).length,
    replayMapEntries: replayMap.entries,
    warnings: unique([...warnings, ...replayMap.warnings]),
    errors: unique(errors)
  };

  await deps.jobStore.saveApiReplayReport(nextReport);
  return buildJobSummary(deps.jobStore, job.id);
}

export function emptyApiReplayReport(jobId: string): ApiReplayReport {
  return createApiReplayReport(jobId);
}

export function reportSkippedApiSnapshot(
  report: ApiReplayReport,
  reason: string
): ApiReplayReport {
  const next = { ...report };
  switch (reason) {
    case "sensitive-url":
      next.skippedSensitive += 1;
      break;
    case "too-large":
      next.skippedTooLarge += 1;
      break;
    case "unsupported-method":
      next.skippedUnsupportedMethod += 1;
      break;
    case "unsupported-content-type":
      next.skippedUnsupportedContentType += 1;
      break;
    default:
      next.warnings = unique([...next.warnings, `api snapshot skipped: ${reason}`]);
      break;
  }
  return next;
}

export function countStoredSnapshot(report: ApiReplayReport, snapshot: ApiSnapshotRecord): ApiReplayReport {
  return {
    ...report,
    capturedResponses: report.capturedResponses + 1,
    storedResponses: snapshot.bodyText || snapshot.bodyBlobId ? report.storedResponses + 1 : report.storedResponses
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
