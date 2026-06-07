import { createBlobStore, createJobStore, type BlobStoreLike, type JobStore } from "@clone3d/storage";
import {
  createApiReplayReport,
  shouldCaptureApiResponse
} from "@clone3d/rewriter";
import { EXTENSION_MESSAGE_TYPES } from "@clone3d/shared";
import type {
  ApiReplayReport,
  ApiSnapshotCapturedMessage,
  ApiSnapshotRecord,
  ApiSnapshotSkippedMessage,
  AssetDiscovery,
  AssetRecord,
  CancelDownloadsRequest,
  CancelPrepare3dRequest,
  CancelPipelineRequest,
  CancelUploadsRequest,
  ContentCaptureResult,
  ExtensionMessage,
  GetApiReplaySummaryRequest,
  GenerateAppHtmlRequest,
  GetDownloadProgressRequest,
  GetJobSummaryRequest,
  GetPipelineProgressRequest,
  GetPrepare3dProgressRequest,
  GetRewriteProgressRequest,
  GetUploadProgressRequest,
  JobStats,
  JobSummary,
  MainWorldEvent,
  PipelineRunRecord,
  PrepareApiReplayRequest,
  Prepare3dAssetsRequest,
  ResumeDownloadsRequest,
  ResumePipelineRequest,
  ResumeUploadsRequest,
  StartCaptureRequest,
  StartDownloadsRequest,
  StartFullPipelineRequest,
  StartUploadsRequest
} from "@clone3d/shared";
import { sha256Blob } from "@clone3d/shared";
import {
  buildJobSummary,
  markDownloadRunFailed,
  prepareAssetDownloads,
  runPreparedAssetDownloads
} from "./download-runner";
import {
  markUploadRunFailed,
  prepareAssetUploads,
  runPreparedAssetUploads
} from "./upload-runner";
import {
  markRewriteRunFailed,
  prepareRewriteJob,
  runPreparedRewriteJob
} from "./rewrite-runner";
import {
  markPrepare3dRunFailed,
  prepareThreeDJob,
  runPreparedThreeDJob
} from "./prepare-3d-runner";
import { prepareApiReplaySnapshots, reportSkippedApiSnapshot } from "./api-replay-runner";
import { SettingsStore } from "../shared/settings-store";

interface RouterDeps {
  jobStore: JobStore;
  blobStore: BlobStoreLike;
  settingsStore: SettingsStore;
}

const recentMainWorldEventsByTab = new Map<number, MainWorldEvent[]>();
const runningDownloadJobs = new Set<string>();
const runningUploadJobs = new Set<string>();
const runningRewriteJobs = new Set<string>();
const runningPrepare3dJobs = new Set<string>();
const runningPipelineRuns = new Set<string>();
const pendingApiSnapshotsByTab = new Map<number, PendingApiSnapshot[]>();

type PendingApiSnapshot =
  | { kind: "captured"; payload: ApiSnapshotCapturedMessage; createdAt: number }
  | { kind: "skipped"; payload: ApiSnapshotSkippedMessage; createdAt: number };

export function createMessageRouter(deps: Partial<RouterDeps> = {}) {
  const jobStore = deps.jobStore ?? createJobStore();
  const blobStore = deps.blobStore ?? createBlobStore();
  const settingsStore = deps.settingsStore ?? new SettingsStore();
  const startedAt = Date.now();

  return async function routeMessage(message: ExtensionMessage, sender: chrome.runtime.MessageSender) {
    switch (message.type) {
      case EXTENSION_MESSAGE_TYPES.ping:
        return {
          ok: true,
          service: "background",
          startedAt,
          tabId: sender.tab?.id ?? null
        };

      case EXTENSION_MESSAGE_TYPES.getStatus:
        return {
          ok: true,
          status: "ready",
          startedAt
        };

      case EXTENSION_MESSAGE_TYPES.contentReady:
        return {
          ok: true,
          receivedAt: Date.now()
        };

      case EXTENSION_MESSAGE_TYPES.mainWorldEvent:
        recordMainWorldEvent(sender.tab?.id, message.payload as MainWorldEvent);
        return {
          ok: true,
          receivedAt: Date.now()
        };

      case EXTENSION_MESSAGE_TYPES.startCapture:
        return startCapture(message.payload as StartCaptureRequest | undefined, jobStore, settingsStore);

      case EXTENSION_MESSAGE_TYPES.getJobSummary:
        return {
          ok: true,
          summary: await getJobSummary(jobStore, message.payload as GetJobSummaryRequest | undefined)
        };

      case EXTENSION_MESSAGE_TYPES.getLatestJobSummary:
        return {
          ok: true,
          summary: await buildJobSummary(jobStore)
        };

      case EXTENSION_MESSAGE_TYPES.startDownloads:
      case EXTENSION_MESSAGE_TYPES.resumeDownloads:
        return startDownloads(
          message.payload as StartDownloadsRequest | ResumeDownloadsRequest | undefined,
          jobStore,
          blobStore,
          settingsStore
        );

      case EXTENSION_MESSAGE_TYPES.getDownloadProgress:
        return getDownloadProgress(message.payload as GetDownloadProgressRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.cancelDownloads:
        return cancelDownloads(message.payload as CancelDownloadsRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.startUploads:
      case EXTENSION_MESSAGE_TYPES.resumeUploads:
        return startUploads(
          message.payload as StartUploadsRequest | ResumeUploadsRequest | undefined,
          jobStore,
          blobStore,
          settingsStore
        );

      case EXTENSION_MESSAGE_TYPES.getUploadProgress:
        return getUploadProgress(message.payload as GetUploadProgressRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.cancelUploads:
        return cancelUploads(message.payload as CancelUploadsRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.generateAppHtml:
        return generateAppHtml(message.payload as GenerateAppHtmlRequest | undefined, jobStore, blobStore, settingsStore);

      case EXTENSION_MESSAGE_TYPES.getRewriteProgress:
        return getRewriteProgress(message.payload as GetRewriteProgressRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.prepare3dAssets:
        return prepare3dAssets(
          message.payload as Prepare3dAssetsRequest | undefined,
          jobStore,
          blobStore,
          settingsStore
        );

      case EXTENSION_MESSAGE_TYPES.getPrepare3dProgress:
        return getPrepare3dProgress(message.payload as GetPrepare3dProgressRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.cancelPrepare3d:
        return cancelPrepare3d(message.payload as CancelPrepare3dRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.apiSnapshotCaptured:
        return apiSnapshotCaptured(
          message.payload as ApiSnapshotCapturedMessage | undefined,
          sender,
          jobStore,
          settingsStore
        );

      case EXTENSION_MESSAGE_TYPES.apiSnapshotSkipped:
        return apiSnapshotSkipped(
          message.payload as ApiSnapshotSkippedMessage | undefined,
          sender,
          jobStore
        );

      case EXTENSION_MESSAGE_TYPES.getApiReplaySummary:
        return getApiReplaySummary(message.payload as GetApiReplaySummaryRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.prepareApiReplay:
        return prepareApiReplay(message.payload as PrepareApiReplayRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.startFullPipeline:
        return startFullPipeline(
          message.payload as StartFullPipelineRequest | undefined,
          sender,
          jobStore,
          blobStore,
          settingsStore
        );

      case EXTENSION_MESSAGE_TYPES.resumePipeline:
        return resumePipeline(
          message.payload as ResumePipelineRequest | undefined,
          jobStore,
          blobStore,
          settingsStore
        );

      case EXTENSION_MESSAGE_TYPES.getPipelineProgress:
        return getPipelineProgress(message.payload as GetPipelineProgressRequest | undefined, jobStore);

      case EXTENSION_MESSAGE_TYPES.cancelPipeline:
        return cancelPipeline(message.payload as CancelPipelineRequest | undefined, jobStore);

      default:
        return {
          ok: false,
          error: "unknown_message_type",
          type: message.type
        };
    }
  };
}

async function apiSnapshotCaptured(
  payload: ApiSnapshotCapturedMessage | undefined,
  sender: chrome.runtime.MessageSender,
  jobStore: JobStore,
  settingsStore: SettingsStore
) {
  if (!payload?.url || !payload.bodyText || payload.method !== "GET") {
    return {
      ok: false,
      error: "invalid_api_snapshot_payload"
    };
  }

  const tabId = sender.tab?.id;
  const job = tabId !== undefined ? await getLatestJobForTab(jobStore, tabId) : await jobStore.getLatestJob();
  if (!job) {
    if (tabId !== undefined) {
      bufferPendingApiSnapshot(tabId, { kind: "captured", payload, createdAt: Date.now() });
    }
    return {
      ok: true,
      buffered: true
    };
  }

  const settings = await settingsStore.get();
  const saved = await persistApiSnapshotForJob(job.id, payload, jobStore, settings);
  return {
    ok: saved.ok,
    error: saved.ok ? undefined : saved.error
  };
}

async function apiSnapshotSkipped(
  payload: ApiSnapshotSkippedMessage | undefined,
  sender: chrome.runtime.MessageSender,
  jobStore: JobStore
) {
  if (!payload?.skippedReason) {
    return {
      ok: false,
      error: "invalid_api_skip_payload"
    };
  }

  const tabId = sender.tab?.id;
  const job = tabId !== undefined ? await getLatestJobForTab(jobStore, tabId) : await jobStore.getLatestJob();
  if (!job) {
    if (tabId !== undefined) {
      bufferPendingApiSnapshot(tabId, { kind: "skipped", payload, createdAt: Date.now() });
    }
    return {
      ok: true,
      buffered: true
    };
  }

  await persistApiSnapshotSkip(job.id, payload, jobStore);
  return {
    ok: true
  };
}

async function getApiReplaySummary(
  request: GetApiReplaySummaryRequest | undefined,
  jobStore: JobStore
) {
  const job = request?.jobId ? await jobStore.getJob(request.jobId) : await jobStore.getLatestJob();
  const report = job ? await jobStore.getApiReplayReport(job.id) : undefined;
  const snapshots = job ? await jobStore.getApiSnapshotsByJob(job.id) : [];

  return {
    ok: true,
    report,
    snapshots
  };
}

async function prepareApiReplay(
  request: PrepareApiReplayRequest | undefined,
  jobStore: JobStore
) {
  const summary = await prepareApiReplaySnapshots(request?.jobId, { jobStore });
  const report = summary.job ? await jobStore.getApiReplayReport(summary.job.id) : undefined;
  const snapshots = summary.job ? await jobStore.getApiSnapshotsByJob(summary.job.id) : [];

  return {
    ok: Boolean(summary.job),
    report,
    snapshots,
    summary
  };
}

async function startFullPipeline(
  request: StartFullPipelineRequest | undefined,
  sender: chrome.runtime.MessageSender,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
) {
  const tabId = request?.tabId ?? sender.tab?.id ?? (await getCaptureTab({})).id;
  if (!tabId) {
    return {
      ok: false,
      error: "active_tab_not_available"
    };
  }

  const settings = await settingsStore.get();
  const now = Date.now();
  const pipelineRun: PipelineRunRecord = {
    id: `pipeline_${now.toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    tabId,
    status: "running",
    stage: "idle",
    startedAt: now,
    updatedAt: now,
    continueOnPartialFailure: settings.pipelineContinueOnPartialFailure,
    autoPrepare3d: settings.pipelineAutoPrepare3d,
    autoGenerateHtml: settings.pipelineAutoGenerateHtml,
    currentStepLabel: "Aguardando inicio",
    errors: [],
    warnings: []
  };

  await jobStore.createPipelineRun(pipelineRun);
  startPipelineAsync(pipelineRun.id, jobStore, blobStore, settingsStore);

  return {
    ok: true,
    pipelineRun,
    summary: await buildJobSummary(jobStore)
  };
}

async function resumePipeline(
  request: ResumePipelineRequest | undefined,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
) {
  const pipelineRun = await resolvePipelineRun(request, jobStore);
  if (!pipelineRun) {
    return {
      ok: false,
      error: "pipeline_not_found"
    };
  }

  await jobStore.updatePipelineRun(pipelineRun.id, {
    status: "running",
    stage: pipelineRun.stage === "failed" || pipelineRun.stage === "cancelled" ? "idle" : pipelineRun.stage,
    finishedAt: undefined,
    currentStepLabel: "Retomando pipeline"
  });
  startPipelineAsync(pipelineRun.id, jobStore, blobStore, settingsStore);
  const updated = await jobStore.getPipelineRun(pipelineRun.id);

  return {
    ok: true,
    pipelineRun: updated,
    job: updated?.jobId ? await jobStore.getJob(updated.jobId) : undefined,
    summary: await buildJobSummary(jobStore, updated?.jobId)
  };
}

async function getPipelineProgress(
  request: GetPipelineProgressRequest | undefined,
  jobStore: JobStore
) {
  const pipelineRun = await resolvePipelineRun(request, jobStore);
  const summary = await buildJobSummary(jobStore, request?.jobId ?? pipelineRun?.jobId);

  return {
    ok: true,
    pipelineRun,
    job: summary.job,
    summary
  };
}

async function cancelPipeline(
  request: CancelPipelineRequest | undefined,
  jobStore: JobStore
) {
  const pipelineRun = await resolvePipelineRun(request, jobStore);
  if (!pipelineRun) {
    return {
      ok: false,
      error: "pipeline_not_found"
    };
  }

  await jobStore.updatePipelineRun(pipelineRun.id, {
    status: "cancelled",
    stage: "cancelled",
    finishedAt: Date.now(),
    currentStepLabel: "Pipeline cancelado"
  });
  if (pipelineRun.jobId) {
    await jobStore.setJobStatus(pipelineRun.jobId, "cancelled");
  }
  const updated = await jobStore.getPipelineRun(pipelineRun.id);

  return {
    ok: true,
    pipelineRun: updated,
    summary: await buildJobSummary(jobStore, updated?.jobId)
  };
}

function startPipelineAsync(
  pipelineRunId: string,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
): void {
  if (runningPipelineRuns.has(pipelineRunId)) {
    return;
  }

  runningPipelineRuns.add(pipelineRunId);
  void runPipeline(pipelineRunId, jobStore, blobStore, settingsStore)
    .catch((error: unknown) => markPipelineFailed(pipelineRunId, jobStore, error))
    .finally(() => {
      runningPipelineRuns.delete(pipelineRunId);
    });
}

async function runPipeline(
  pipelineRunId: string,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
): Promise<void> {
  let pipelineRun = await jobStore.getPipelineRun(pipelineRunId);
  if (!pipelineRun || pipelineRun.status === "cancelled") {
    return;
  }

  const settings = await settingsStore.get();
  let jobId = pipelineRun.jobId;

  if (!jobId) {
    await updatePipelineStage(jobStore, pipelineRunId, "capturing", "Capturando pagina");
    const captureResponse = await startCapture({ tabId: pipelineRun.tabId }, jobStore, settingsStore) as { ok?: boolean; summary?: JobSummary; error?: string };
    if (!captureResponse.ok || !captureResponse.summary?.job?.id) {
      throw new Error(captureResponse.error || "pipeline_capture_failed");
    }

    jobId = captureResponse.summary.job.id;
    await jobStore.updatePipelineRun(pipelineRunId, {
      jobId,
      warnings: [...pipelineRun.warnings, "Para capturar APIs chamadas no inicio da pagina, recarregue a pagina antes da captura."]
    });
  }

  await stopIfPipelineCancelled(jobStore, pipelineRunId, jobId);
  await updatePipelineStage(jobStore, pipelineRunId, "downloading", "Baixando assets");
  await runDownloadStage(jobId, jobStore, blobStore, settingsStore);
  await assertPipelineCanContinue(jobStore, pipelineRunId, jobId);

  await stopIfPipelineCancelled(jobStore, pipelineRunId, jobId);
  await updatePipelineStage(jobStore, pipelineRunId, "uploading", "Enviando assets para Catbox");
  await runUploadStage(jobId, jobStore, blobStore, settingsStore);
  await assertPipelineCanContinue(jobStore, pipelineRunId, jobId);

  await stopIfPipelineCancelled(jobStore, pipelineRunId, jobId);
  pipelineRun = await jobStore.getPipelineRun(pipelineRunId);
  if (pipelineRun?.autoPrepare3d && (await jobHasThreeDAssets(jobStore, jobId))) {
    await updatePipelineStage(jobStore, pipelineRunId, "preparing-3d", "Preparando assets 3D");
    await runPrepare3dStage(jobId, jobStore, blobStore, settingsStore);
    await assertPipelineCanContinue(jobStore, pipelineRunId, jobId);
  }

  await stopIfPipelineCancelled(jobStore, pipelineRunId, jobId);
  pipelineRun = await jobStore.getPipelineRun(pipelineRunId);
  if (pipelineRun?.autoGenerateHtml) {
    await updatePipelineStage(jobStore, pipelineRunId, "rewriting", "Gerando app.html");
    await runRewriteStage(jobId, jobStore, blobStore, settingsStore);
    await assertPipelineCanContinue(jobStore, pipelineRunId, jobId);
  }

  await jobStore.updatePipelineRun(pipelineRunId, {
    status: "completed",
    stage: "completed",
    finishedAt: Date.now(),
    currentStepLabel: "Pipeline concluido"
  });
}

async function runDownloadStage(
  jobId: string,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
): Promise<void> {
  const settings = await settingsStore.get();
  const deps = {
    jobStore,
    blobStore,
    options: {
      concurrency: settings.downloadConcurrency,
      timeoutMs: settings.downloadTimeoutMs,
      maxAttempts: settings.maxDownloadAttempts
    }
  };
  const prepared = await prepareAssetDownloads(jobId, deps);
  if (prepared.job) {
    await runPreparedAssetDownloads(prepared.job.id, deps);
  }
}

async function runUploadStage(
  jobId: string,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
): Promise<void> {
  const settings = await settingsStore.get();
  const deps = {
    jobStore,
    blobStore,
    options: {
      concurrency: settings.uploadConcurrency,
      timeoutMs: settings.uploadTimeoutMs,
      maxAttempts: settings.maxUploadAttempts,
      endpoint: settings.catboxUploadEndpoint
    }
  };
  const prepared = await prepareAssetUploads(jobId, deps);
  if (prepared.job?.status === "uploading") {
    await runPreparedAssetUploads(prepared.job.id, deps);
  }
}

async function runPrepare3dStage(
  jobId: string,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
): Promise<void> {
  const settings = await settingsStore.get();
  const deps = {
    jobStore,
    blobStore,
    options: {
      endpoint: settings.catboxUploadEndpoint,
      timeoutMs: settings.uploadTimeoutMs,
      maxAttempts: settings.maxUploadAttempts
    }
  };
  const prepared = await prepareThreeDJob(jobId, deps);
  if (prepared.job?.status === "preparing-3d") {
    await runPreparedThreeDJob(prepared.job.id, deps);
  }
}

async function runRewriteStage(
  jobId: string,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
): Promise<void> {
  const settings = await settingsStore.get();
  const deps = {
    jobStore,
    blobStore,
    settings
  };
  const prepared = await prepareRewriteJob(jobId, deps);
  if (prepared.job?.status === "rewriting") {
    await runPreparedRewriteJob(prepared.job.id, deps);
  }
}

async function assertPipelineCanContinue(jobStore: JobStore, pipelineRunId: string, jobId: string): Promise<void> {
  const pipelineRun = await jobStore.getPipelineRun(pipelineRunId);
  const job = await jobStore.getJob(jobId);
  if (!pipelineRun || !job) {
    throw new Error("pipeline_state_missing");
  }

  if (pipelineRun.status === "cancelled" || job.status === "cancelled") {
    throw new Error("pipeline_cancelled");
  }

  if (job.status === "failed" || job.status === "rewrite-failed" || job.status === "prepare-3d-failed") {
    if (!pipelineRun.continueOnPartialFailure) {
      throw new Error(`pipeline_stage_failed:${job.status}`);
    }

    await jobStore.updatePipelineRun(pipelineRunId, {
      warnings: [...pipelineRun.warnings, `Continuando apos falha parcial: ${job.status}`]
    });
  }
}

async function stopIfPipelineCancelled(jobStore: JobStore, pipelineRunId: string, jobId?: string): Promise<void> {
  const pipelineRun = await jobStore.getPipelineRun(pipelineRunId);
  const job = jobId ? await jobStore.getJob(jobId) : undefined;
  if (pipelineRun?.status === "cancelled" || job?.status === "cancelled") {
    throw new Error("pipeline_cancelled");
  }
}

async function updatePipelineStage(
  jobStore: JobStore,
  pipelineRunId: string,
  stage: PipelineRunRecord["stage"],
  currentStepLabel: string
): Promise<void> {
  await jobStore.updatePipelineRun(pipelineRunId, {
    status: "running",
    stage,
    currentStepLabel,
    updatedAt: Date.now()
  });
}

async function markPipelineFailed(pipelineRunId: string, jobStore: JobStore, error: unknown): Promise<void> {
  const current = await jobStore.getPipelineRun(pipelineRunId);
  if (!current || current.status === "cancelled") {
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  await jobStore.updatePipelineRun(pipelineRunId, {
    status: message === "pipeline_cancelled" ? "cancelled" : "failed",
    stage: message === "pipeline_cancelled" ? "cancelled" : "failed",
    finishedAt: Date.now(),
    currentStepLabel: message === "pipeline_cancelled" ? "Pipeline cancelado" : "Pipeline falhou",
    errors: [...current.errors, message]
  });
}

async function resolvePipelineRun(
  request: ResumePipelineRequest | GetPipelineProgressRequest | CancelPipelineRequest | undefined,
  jobStore: JobStore
): Promise<PipelineRunRecord | undefined> {
  if (request?.pipelineRunId) {
    return jobStore.getPipelineRun(request.pipelineRunId);
  }

  if (request?.jobId) {
    return jobStore.getPipelineRunByJob(request.jobId);
  }

  return jobStore.getLatestPipelineRun();
}

async function jobHasThreeDAssets(jobStore: JobStore, jobId: string): Promise<boolean> {
  const assets = await jobStore.getAssetsByJob(jobId);
  return assets.some((asset) => {
    if (asset.isDerivedAsset) {
      return false;
    }

    const value = `${asset.normalizedUrl} ${asset.originalUrl}`.toLowerCase();
    return (
      asset.is3dAsset ||
      Boolean(asset.assetRole && !["html", "css", "script", "json", "image", "audio", "video", "unknown"].includes(asset.assetRole)) ||
      /\.(gltf|glb|bin|drc|ktx2|basis|wasm|hdr|exr)(?:[?#\s]|$)/i.test(value) ||
      /(?:draco|basis_transcoder|meshopt|ktx2loader|dracoloader|\.worker\.(?:js|mjs))/i.test(value)
    );
  });
}

async function persistApiSnapshotForJob(
  jobId: string,
  payload: ApiSnapshotCapturedMessage,
  jobStore: JobStore,
  settings: Awaited<ReturnType<SettingsStore["get"]>>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const job = await jobStore.getJob(jobId);
  const normalizedUrl = normalizeUrl(payload.normalizedUrl || payload.url, job?.pageUrl) || payload.url;
  const bodySize = new TextEncoder().encode(payload.bodyText).byteLength;
  const decision = shouldCaptureApiResponse({
    method: payload.method,
    url: normalizedUrl,
    pageUrl: payload.pageUrl || job?.pageUrl,
    status: payload.status,
    contentType: payload.contentType,
    size: bodySize || payload.size,
    hasAuthorizationHeader: false,
    settings
  });

  if (!decision.ok) {
    await persistApiSnapshotSkip(jobId, {
      method: payload.method,
      url: payload.url,
      normalizedUrl,
      pageUrl: payload.pageUrl,
      frameUrl: payload.frameUrl,
      contentType: payload.contentType,
      size: bodySize || payload.size,
      skippedReason: decision.reason,
      source: payload.source,
      capturedAt: payload.capturedAt
    }, jobStore);
    return {
      ok: false,
      error: decision.reason
    };
  }

  const sha256 = await sha256Blob(new Blob([payload.bodyText], { type: payload.contentType || "text/plain" }));
  const existing = await jobStore.getApiSnapshotByMethodAndUrl(jobId, payload.method, normalizedUrl);
  if (existing?.sha256 === sha256) {
    await jobStore.updateApiSnapshot(existing.id, {
      updatedAt: Date.now(),
      status: "captured",
      replayable: true,
      lastError: undefined
    });
    return { ok: true };
  }

  const now = Date.now();
  const record: ApiSnapshotRecord = {
    id: `api:${jobId}:${hashString(`${payload.method} ${normalizedUrl} ${sha256}`)}`,
    jobId,
    method: "GET",
    url: payload.url,
    normalizedUrl,
    urlWithoutHash: normalizedUrl.split("#")[0],
    pageUrl: payload.pageUrl || job?.pageUrl,
    frameUrl: payload.frameUrl,
    status: "captured",
    httpStatus: payload.status,
    contentType: payload.contentType || "application/json; charset=utf-8",
    size: bodySize || payload.size,
    bodyText: payload.bodyText,
    source: payload.source,
    capturedAt: payload.capturedAt || now,
    updatedAt: now,
    replayable: true,
    rewritten: false,
    sha256,
    methodAndUrl: `${payload.method} ${normalizedUrl}`
  };

  await jobStore.putApiSnapshot(record);
  const currentReport = (await jobStore.getApiReplayReport(jobId)) ?? createApiReplayReport(jobId);
  await jobStore.saveApiReplayReport({
    ...currentReport,
    capturedResponses: currentReport.capturedResponses + 1,
    storedResponses: currentReport.storedResponses + 1
  });

  return { ok: true };
}

async function persistApiSnapshotSkip(
  jobId: string,
  payload: ApiSnapshotSkippedMessage,
  jobStore: JobStore
): Promise<void> {
  const currentReport = (await jobStore.getApiReplayReport(jobId)) ?? createApiReplayReport(jobId);
  await jobStore.saveApiReplayReport(reportSkippedApiSnapshot(currentReport, payload.skippedReason));
}

function bufferPendingApiSnapshot(tabId: number, snapshot: PendingApiSnapshot): void {
  const maxAgeMs = 10 * 60 * 1000;
  const now = Date.now();
  const pending = (pendingApiSnapshotsByTab.get(tabId) ?? [])
    .filter((item) => now - item.createdAt <= maxAgeMs)
    .slice(-99);
  pending.push(snapshot);
  pendingApiSnapshotsByTab.set(tabId, pending);
}

async function flushPendingApiSnapshotsForJob(
  tabId: number,
  jobId: string,
  jobStore: JobStore,
  settingsStore: SettingsStore
): Promise<void> {
  const pending = pendingApiSnapshotsByTab.get(tabId) ?? [];
  if (pending.length === 0) {
    return;
  }

  const settings = await settingsStore.get();
  for (const item of pending) {
    if (item.kind === "captured") {
      await persistApiSnapshotForJob(jobId, item.payload, jobStore, settings);
    } else {
      await persistApiSnapshotSkip(jobId, item.payload, jobStore);
    }
  }

  pendingApiSnapshotsByTab.delete(tabId);
}

async function prepare3dAssets(
  request: Prepare3dAssetsRequest | undefined,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
) {
  const currentJob = request?.jobId ? await jobStore.getJob(request.jobId) : await jobStore.getLatestJob();
  const summaryBeforeStart = await buildJobSummary(jobStore, currentJob?.id);

  if (!currentJob) {
    return {
      ok: false,
      error: "job_not_found",
      summary: summaryBeforeStart
    };
  }

  if (currentJob.status === "preparing-3d" && runningPrepare3dJobs.has(currentJob.id)) {
    return {
      ok: true,
      job: summaryBeforeStart.job,
      report: summaryBeforeStart.job?.threeDPreparationReport,
      summary: summaryBeforeStart
    };
  }

  const settings = await settingsStore.get();
  const deps = {
    jobStore,
    blobStore,
    options: {
      endpoint: settings.catboxUploadEndpoint,
      timeoutMs: settings.uploadTimeoutMs,
      maxAttempts: settings.maxUploadAttempts,
      force: Boolean(request?.force)
    }
  };
  const summary = await prepareThreeDJob(currentJob.id, deps);

  if (summary.job?.status === "preparing-3d" && !runningPrepare3dJobs.has(summary.job.id)) {
    const runJobId = summary.job.id;
    runningPrepare3dJobs.add(runJobId);
    void runPreparedThreeDJob(runJobId, deps)
      .catch((error: unknown) => markPrepare3dRunFailed(runJobId, jobStore, error))
      .finally(() => {
        runningPrepare3dJobs.delete(runJobId);
      });
  }

  return {
    ok: Boolean(summary.job),
    job: summary.job,
    report: summary.job?.threeDPreparationReport,
    summary
  };
}

async function getPrepare3dProgress(
  request: GetPrepare3dProgressRequest | undefined,
  jobStore: JobStore
) {
  const summary = await buildJobSummary(jobStore, request?.jobId);
  const report = summary.job?.id ? await jobStore.getThreeDPreparationReport(summary.job.id) : undefined;

  return {
    ok: true,
    job: summary.job,
    report,
    threeDReport: report,
    summary
  };
}

async function cancelPrepare3d(
  request: CancelPrepare3dRequest | undefined,
  jobStore: JobStore
) {
  if (!request?.jobId) {
    return {
      ok: false,
      error: "job_id_required"
    };
  }

  const job = await jobStore.setJobStatus(request.jobId, "cancelled");
  const summary = await buildJobSummary(jobStore, request.jobId);

  return {
    ok: Boolean(job),
    job,
    summary
  };
}

async function generateAppHtml(
  request: GenerateAppHtmlRequest | undefined,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
) {
  const currentJob = request?.jobId ? await jobStore.getJob(request.jobId) : await jobStore.getLatestJob();
  const summaryBeforeStart = await buildJobSummary(jobStore, currentJob?.id);

  if (!currentJob) {
    return {
      ok: false,
      error: "job_not_found",
      summary: summaryBeforeStart
    };
  }

  if (currentJob.status === "rewriting" && runningRewriteJobs.has(currentJob.id)) {
    return {
      ok: true,
      job: summaryBeforeStart.job,
      report: summaryBeforeStart.job?.rewriteReport,
      summary: summaryBeforeStart
    };
  }

  const settings = await settingsStore.get();
  const deps = {
    jobStore,
    blobStore,
    settings
  };
  const summary = await prepareRewriteJob(currentJob.id, deps);

  if (summary.job?.status === "rewriting" && !runningRewriteJobs.has(summary.job.id)) {
    const runJobId = summary.job.id;
    runningRewriteJobs.add(runJobId);
    void runPreparedRewriteJob(runJobId, deps)
      .catch((error: unknown) => markRewriteRunFailed(runJobId, jobStore, error))
      .finally(() => {
        runningRewriteJobs.delete(runJobId);
      });
  }

  return {
    ok: Boolean(summary.job),
    job: summary.job,
    report: summary.job?.rewriteReport,
    summary
  };
}

async function getRewriteProgress(
  request: GetRewriteProgressRequest | undefined,
  jobStore: JobStore
) {
  const summary = await buildJobSummary(jobStore, request?.jobId);

  return {
    ok: true,
    job: summary.job,
    report: summary.job?.rewriteReport,
    summary
  };
}

async function startUploads(
  request: StartUploadsRequest | ResumeUploadsRequest | undefined,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
) {
  const currentJob = request?.jobId ? await jobStore.getJob(request.jobId) : await jobStore.getLatestJob();
  const summaryBeforeStart = await buildJobSummary(jobStore, currentJob?.id);

  if (!currentJob) {
    return {
      ok: false,
      error: "job_not_found",
      summary: summaryBeforeStart
    };
  }

  if (currentJob.status === "uploading" && runningUploadJobs.has(currentJob.id)) {
    return {
      ok: true,
      job: summaryBeforeStart.job,
      summary: summaryBeforeStart
    };
  }

  const settings = await settingsStore.get();
  const runnerDeps = {
    jobStore,
    blobStore,
    options: {
      concurrency: settings.uploadConcurrency,
      timeoutMs: settings.uploadTimeoutMs,
      maxAttempts: settings.maxUploadAttempts,
      endpoint: settings.catboxUploadEndpoint
    }
  };
  const summary = await prepareAssetUploads(currentJob.id, runnerDeps);

  if (summary.job?.status === "uploading" && !runningUploadJobs.has(summary.job.id)) {
    const runJobId = summary.job.id;
    runningUploadJobs.add(runJobId);
    void runPreparedAssetUploads(runJobId, runnerDeps)
      .catch((error: unknown) => markUploadRunFailed(runJobId, jobStore, error))
      .finally(() => {
        runningUploadJobs.delete(runJobId);
      });
  }

  return {
    ok: Boolean(summary.job),
    job: summary.job,
    summary
  };
}

async function getUploadProgress(
  request: GetUploadProgressRequest | undefined,
  jobStore: JobStore
) {
  const summary = await buildJobSummary(jobStore, request?.jobId);

  return {
    ok: true,
    job: summary.job,
    assets: summary.assets,
    summary
  };
}

async function cancelUploads(
  request: CancelUploadsRequest | undefined,
  jobStore: JobStore
) {
  if (!request?.jobId) {
    return {
      ok: false,
      error: "job_id_required"
    };
  }

  const job = await jobStore.setJobStatus(request.jobId, "cancelled");
  await jobStore.updateJobStats(request.jobId);
  const summary = await buildJobSummary(jobStore, request.jobId);

  return {
    ok: Boolean(job),
    job,
    summary
  };
}

async function startCapture(
  request: StartCaptureRequest | undefined,
  jobStore: JobStore,
  settingsStore: SettingsStore
) {
  const tab = await getCaptureTab(request);
  if (!tab.id || !tab.url) {
    return {
      ok: false,
      error: "active_tab_not_available"
    };
  }

  const settings = await settingsStore.get();
  const mode = request?.mode ?? settings.defaultCaptureMode;
  const now = Date.now();
  const job = {
    id: createJobId(),
    tabId: tab.id,
    frameIds: [0],
    pageUrl: tab.url,
    pageTitle: tab.title,
    createdAt: now,
    updatedAt: now,
    status: "capturing" as const,
    mode,
    stats: emptyStats(),
    errors: []
  };

  await jobStore.putJob(job);
  await flushPendingApiSnapshotsForJob(tab.id, job.id, jobStore, settingsStore);

  try {
    const contentResponse = await chrome.tabs.sendMessage(tab.id, {
      type: EXTENSION_MESSAGE_TYPES.contentCaptureRequest,
      payload: {
        jobId: job.id,
        mode
      }
    });

    if (contentResponse?.type !== EXTENSION_MESSAGE_TYPES.contentCaptureResult) {
      throw new Error("Invalid content capture response");
    }

    const result = contentResponse.payload as ContentCaptureResult;
    const backgroundEvents = recentMainWorldEventsByTab.get(tab.id) ?? [];
    const eventAssets = backgroundEvents.flatMap((event) => mainWorldEventToDiscovery(event, result.pageUrl));
    const assets = buildAssetRecords(job.id, [...result.assets, ...eventAssets]);
    const stats = {
      ...emptyStats(),
      totalAssets: assets.length,
      discoveredAssets: assets.length
    };

    await jobStore.putAssets(job.id, assets);
    if (result.htmlSnapshot) {
      await jobStore.putHtmlSnapshot({
        id: `html:${job.id}`,
        jobId: job.id,
        html: result.htmlSnapshot.html,
        doctype: result.htmlSnapshot.doctype,
        pageUrl: result.htmlSnapshot.documentUrl,
        baseUrl: result.htmlSnapshot.baseUrl,
        title: result.htmlSnapshot.title,
        capturedAt: result.htmlSnapshot.capturedAt
      });
    }
    await jobStore.putJob({
      ...job,
      pageUrl: result.pageUrl || job.pageUrl,
      pageTitle: result.pageTitle || job.pageTitle,
      updatedAt: Date.now(),
      status: "captured",
      stats
    });

    return {
      ok: true,
      summary: await buildJobSummary(jobStore, job.id)
    };
  } catch (error) {
    await jobStore.putJob({
      ...job,
      updatedAt: Date.now(),
      status: "failed",
      errors: [
        ...job.errors,
        {
          code: "content_capture_failed",
          message: error instanceof Error ? error.message : "Unknown capture error",
          createdAt: Date.now()
        }
      ]
    });

    return {
      ok: false,
      error: "content_capture_failed",
      message: error instanceof Error ? error.message : "Unknown capture error",
      summary: await buildJobSummary(jobStore, job.id)
    };
  }
}

async function startDownloads(
  request: StartDownloadsRequest | ResumeDownloadsRequest | undefined,
  jobStore: JobStore,
  blobStore: BlobStoreLike,
  settingsStore: SettingsStore
) {
  const currentJob = request?.jobId ? await jobStore.getJob(request.jobId) : await jobStore.getLatestJob();
  if (currentJob?.status === "downloading" && runningDownloadJobs.has(currentJob.id)) {
    const summary = await buildJobSummary(jobStore, currentJob.id);
    return {
      ok: true,
      job: summary.job,
      summary
    };
  }

  const settings = await settingsStore.get();
  const runnerDeps = {
    jobStore,
    blobStore,
    options: {
      concurrency: settings.downloadConcurrency,
      timeoutMs: settings.downloadTimeoutMs,
      maxAttempts: settings.maxDownloadAttempts
    }
  };
  const summary = await prepareAssetDownloads(request?.jobId, runnerDeps);

  if (summary.job && !runningDownloadJobs.has(summary.job.id)) {
    const runJobId = summary.job.id;
    runningDownloadJobs.add(runJobId);
    void runPreparedAssetDownloads(runJobId, runnerDeps)
      .catch((error: unknown) => markDownloadRunFailed(runJobId, jobStore, error))
      .finally(() => {
        runningDownloadJobs.delete(runJobId);
      });
  }

  return {
    ok: Boolean(summary.job),
    job: summary.job,
    summary
  };
}

async function getDownloadProgress(
  request: GetDownloadProgressRequest | undefined,
  jobStore: JobStore
) {
  const summary = await buildJobSummary(jobStore, request?.jobId);

  return {
    ok: true,
    job: summary.job,
    assets: summary.assets,
    summary
  };
}

async function cancelDownloads(
  request: CancelDownloadsRequest | undefined,
  jobStore: JobStore
) {
  if (!request?.jobId) {
    return {
      ok: false,
      error: "job_id_required"
    };
  }

  const job = await jobStore.setJobStatus(request.jobId, "cancelled");
  await jobStore.updateJobStats(request.jobId);
  const summary = await buildJobSummary(jobStore, request.jobId);

  return {
    ok: Boolean(job),
    job,
    summary
  };
}

async function getJobSummary(
  jobStore: JobStore,
  request: GetJobSummaryRequest | undefined
): Promise<JobSummary> {
  return buildJobSummary(jobStore, request?.jobId);
}

async function getCaptureTab(request: StartCaptureRequest | undefined): Promise<chrome.tabs.Tab> {
  if (typeof request?.tabId === "number") {
    return chrome.tabs.get(request.tabId);
  }

  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  return tab;
}

async function getLatestJobForTab(jobStore: JobStore, tabId: number): Promise<Awaited<ReturnType<JobStore["getLatestJob"]>>> {
  return (await jobStore.list())
    .filter((job) => job.tabId === tabId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

function buildAssetRecords(jobId: string, discoveries: AssetDiscovery[]): AssetRecord[] {
  const byUrl = new Map<string, AssetRecord>();

  for (const discovery of discoveries) {
    const normalizedUrl = normalizeUrl(discovery.normalizedUrl);
    if (!normalizedUrl) {
      continue;
    }

    const existing = byUrl.get(normalizedUrl);
    if (existing) {
      existing.source = [...new Set([...existing.source, ...discovery.source])];
      existing.referrerUrl ??= discovery.referrerUrl;
      existing.frameUrl ??= discovery.frameUrl;
      existing.updatedAt = Date.now();
      continue;
    }

    const now = Date.now();
    byUrl.set(normalizedUrl, {
      id: `asset:${jobId}:${hashString(normalizedUrl)}`,
      jobId,
      originalUrl: discovery.rawUrl,
      normalizedUrl,
      referrerUrl: discovery.referrerUrl,
      frameUrl: discovery.frameUrl,
      source: [...new Set(discovery.source)],
      status: "discovered",
      detectedExtension: getExtension(normalizedUrl),
      shouldInline: false,
      is3dAsset: is3dAsset(normalizedUrl),
      isApiResponse: false,
      isGeneratedBlob: normalizedUrl.startsWith("blob:"),
      createdAt: now,
      discoveredAt: discovery.discoveredAt,
      updatedAt: now
    });
  }

  return [...byUrl.values()];
}

function mainWorldEventToDiscovery(event: MainWorldEvent, baseUrl: string): AssetDiscovery[] {
  if (!event.url || event.kind === "api-response" || event.kind === "api-response-skipped") {
    return [];
  }

  const normalizedUrl = normalizeUrl(event.url, baseUrl);
  if (!normalizedUrl) {
    return [];
  }

  return [
    {
      rawUrl: event.url,
      normalizedUrl,
      source:
        event.kind === "fetch"
          ? ["fetch-hook"]
          : event.kind === "xhr-open"
            ? ["xhr-hook"]
            : event.kind === "worker"
              ? ["worker-hook"]
              : event.kind === "wasm-streaming"
                ? ["script"]
                : ["image-hook"],
      frameUrl: event.pageUrl,
      element: event.kind,
      attribute: "url",
      discoveredAt: event.createdAt
    }
  ];
}

function normalizeUrl(value: string, baseUrl?: string): string | undefined {
  try {
    const url = new URL(value, baseUrl);
    if (url.protocol === "javascript:" || url.protocol === "mailto:") {
      return undefined;
    }

    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

function emptyStats(): JobStats {
  return {
    totalAssets: 0,
    queuedAssets: 0,
    downloadingAssets: 0,
    discoveredAssets: 0,
    downloadedAssets: 0,
    failedAssets: 0,
    skippedAssets: 0,
    totalBytes: 0,
    downloadedBytes: 0,
    uploadedAssets: 0,
    totalUploadedBytes: 0
  };
}

function createJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function getExtension(url: string): string | undefined {
  try {
    const pathname = new URL(url).pathname;
    const match = pathname.match(/\.([a-z0-9]+)$/i);
    return match ? `.${match[1].toLowerCase()}` : undefined;
  } catch {
    return undefined;
  }
}

function is3dAsset(url: string): boolean {
  const extension = getExtension(url);
  return Boolean(
    extension &&
      [".glb", ".gltf", ".bin", ".drc", ".ktx2", ".basis", ".wasm", ".hdr", ".exr"].includes(extension)
  );
}

function recordMainWorldEvent(tabId: number | undefined, event: MainWorldEvent): void {
  if (!tabId) {
    return;
  }

  const events = recentMainWorldEventsByTab.get(tabId) ?? [];
  events.push(event);

  if (events.length > 500) {
    events.splice(0, events.length - 500);
  }

  recentMainWorldEventsByTab.set(tabId, events);
}

function hashString(value: string): string {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}
