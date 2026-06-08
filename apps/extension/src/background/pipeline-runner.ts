import type { BlobStoreLike, JobStore } from "@clone3d/storage";
import type {
  CancelPipelineRequest,
  GetPipelineProgressRequest,
  JobSummary,
  PipelineRunRecord,
  ResumePipelineRequest
} from "@clone3d/shared";
import {
  buildJobSummary,
  prepareAssetDownloads,
  runPreparedAssetDownloads
} from "./download-runner";
import {
  prepareAssetUploads,
  runPreparedAssetUploads
} from "./upload-runner";
import {
  prepareRewriteJob,
  runPreparedRewriteJob
} from "./rewrite-runner";
import {
  prepareThreeDJob,
  runPreparedThreeDJob
} from "./prepare-3d-runner";
import type { SettingsStore } from "../shared/settings-store";

export interface PipelineRunnerDeps {
  jobStore: JobStore;
  blobStore: BlobStoreLike;
  settingsStore: SettingsStore;
  captureJob: (tabId?: number) => Promise<{ ok?: boolean; summary?: JobSummary; error?: string }>;
}

const runningPipelineRuns = new Set<string>();

export async function startPipelineRun(tabId: number | undefined, deps: PipelineRunnerDeps) {
  if (!tabId) {
    return {
      ok: false,
      error: "active_tab_not_available"
    };
  }

  const settings = await deps.settingsStore.get();
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

  await deps.jobStore.createPipelineRun(pipelineRun);
  startPipelineAsync(pipelineRun.id, deps);

  return {
    ok: true,
    pipelineRun,
    summary: await buildJobSummary(deps.jobStore)
  };
}

export async function resumePipelineRun(request: ResumePipelineRequest | undefined, deps: PipelineRunnerDeps) {
  const pipelineRun = await resolvePipelineRun(request, deps.jobStore);
  if (!pipelineRun) {
    return {
      ok: false,
      error: "pipeline_not_found"
    };
  }

  await deps.jobStore.updatePipelineRun(pipelineRun.id, {
    status: "running",
    stage: pipelineRun.stage === "failed" || pipelineRun.stage === "cancelled" ? "idle" : pipelineRun.stage,
    finishedAt: undefined,
    currentStepLabel: "Retomando pipeline",
    updatedAt: Date.now()
  });
  startPipelineAsync(pipelineRun.id, deps);
  const updated = await deps.jobStore.getPipelineRun(pipelineRun.id);

  return {
    ok: true,
    pipelineRun: updated,
    job: updated?.jobId ? await deps.jobStore.getJob(updated.jobId) : undefined,
    summary: await buildJobSummary(deps.jobStore, updated?.jobId)
  };
}

export async function getPipelineRunProgress(request: GetPipelineProgressRequest | undefined, jobStore: JobStore) {
  const pipelineRun = await resolvePipelineRun(request, jobStore);
  const summary = await buildJobSummary(jobStore, request?.jobId ?? pipelineRun?.jobId);

  return {
    ok: true,
    pipelineRun,
    job: summary.job,
    summary
  };
}

export async function cancelPipelineRun(request: CancelPipelineRequest | undefined, jobStore: JobStore) {
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
    currentStepLabel: "Pipeline cancelado",
    updatedAt: Date.now()
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

function startPipelineAsync(pipelineRunId: string, deps: PipelineRunnerDeps): void {
  if (runningPipelineRuns.has(pipelineRunId)) {
    return;
  }

  runningPipelineRuns.add(pipelineRunId);
  void runPipeline(pipelineRunId, deps)
    .catch((error: unknown) => markPipelineFailed(pipelineRunId, deps.jobStore, error))
    .finally(() => {
      runningPipelineRuns.delete(pipelineRunId);
    });
}

async function runPipeline(pipelineRunId: string, deps: PipelineRunnerDeps): Promise<void> {
  let pipelineRun = await deps.jobStore.getPipelineRun(pipelineRunId);
  if (!pipelineRun || pipelineRun.status === "cancelled") {
    return;
  }

  let jobId = pipelineRun.jobId;

  if (!jobId) {
    await updatePipelineStage(deps.jobStore, pipelineRunId, "capturing", "Capturando pagina");
    const captureResponse = await deps.captureJob(pipelineRun.tabId);
    if (!captureResponse.ok || !captureResponse.summary?.job?.id) {
      throw new Error(captureResponse.error || "pipeline_capture_failed");
    }

    jobId = captureResponse.summary.job.id;
    await deps.jobStore.updatePipelineRun(pipelineRunId, {
      jobId,
      warnings: [
        ...pipelineRun.warnings,
        "Para capturar APIs chamadas no inicio da pagina, recarregue a pagina antes da captura."
      ],
      updatedAt: Date.now()
    });
  }

  await stopIfPipelineCancelled(deps.jobStore, pipelineRunId, jobId);
  await updatePipelineStage(deps.jobStore, pipelineRunId, "downloading", "Baixando assets");
  await runDownloadStage(jobId, deps);
  await assertPipelineCanContinue(deps.jobStore, pipelineRunId, jobId);

  await stopIfPipelineCancelled(deps.jobStore, pipelineRunId, jobId);
  await updatePipelineStage(deps.jobStore, pipelineRunId, "uploading", "Enviando assets para Catbox");
  await runUploadStage(jobId, deps);
  await assertPipelineCanContinue(deps.jobStore, pipelineRunId, jobId);

  await stopIfPipelineCancelled(deps.jobStore, pipelineRunId, jobId);
  pipelineRun = await deps.jobStore.getPipelineRun(pipelineRunId);
  if (pipelineRun?.autoPrepare3d && (await jobHasThreeDAssets(deps.jobStore, jobId))) {
    await updatePipelineStage(deps.jobStore, pipelineRunId, "preparing-3d", "Preparando assets 3D");
    await runPrepare3dStage(jobId, deps);
    await assertPipelineCanContinue(deps.jobStore, pipelineRunId, jobId);
  } else if (pipelineRun?.autoPrepare3d) {
    await deps.jobStore.updatePipelineRun(pipelineRunId, {
      warnings: [...pipelineRun.warnings, "No 3D assets detected. Skipping 3D preparation."],
      currentStepLabel: "Nenhum asset 3D detectado. Preparacao 3D pulada.",
      updatedAt: Date.now()
    });
  }

  await stopIfPipelineCancelled(deps.jobStore, pipelineRunId, jobId);
  pipelineRun = await deps.jobStore.getPipelineRun(pipelineRunId);
  if (pipelineRun?.autoGenerateHtml) {
    await updatePipelineStage(deps.jobStore, pipelineRunId, "rewriting", "Gerando app.html");
    await runRewriteStage(jobId, deps);
    await assertPipelineCanContinue(deps.jobStore, pipelineRunId, jobId);
  }

  await deps.jobStore.updatePipelineRun(pipelineRunId, {
    status: "completed",
    stage: "completed",
    finishedAt: Date.now(),
    currentStepLabel: "Pipeline concluido",
    updatedAt: Date.now()
  });
}

async function runDownloadStage(jobId: string, deps: PipelineRunnerDeps): Promise<void> {
  const settings = await deps.settingsStore.get();
  const runnerDeps = {
    jobStore: deps.jobStore,
    blobStore: deps.blobStore,
    options: {
      concurrency: settings.downloadConcurrency,
      timeoutMs: settings.downloadTimeoutMs,
      maxAttempts: settings.maxDownloadAttempts
    }
  };
  const prepared = await prepareAssetDownloads(jobId, runnerDeps);
  if (prepared.job) {
    await runPreparedAssetDownloads(prepared.job.id, runnerDeps);
  }
}

async function runUploadStage(jobId: string, deps: PipelineRunnerDeps): Promise<void> {
  const settings = await deps.settingsStore.get();
  const runnerDeps = {
    jobStore: deps.jobStore,
    blobStore: deps.blobStore,
    options: {
      concurrency: settings.uploadConcurrency,
      timeoutMs: settings.uploadTimeoutMs,
      maxAttempts: settings.maxUploadAttempts,
      endpoint: settings.catboxUploadEndpoint
    }
  };
  const prepared = await prepareAssetUploads(jobId, runnerDeps);
  if (prepared.job?.status === "uploading") {
    await runPreparedAssetUploads(prepared.job.id, runnerDeps);
  }
}

async function runPrepare3dStage(jobId: string, deps: PipelineRunnerDeps): Promise<void> {
  const settings = await deps.settingsStore.get();
  const runnerDeps = {
    jobStore: deps.jobStore,
    blobStore: deps.blobStore,
    options: {
      endpoint: settings.catboxUploadEndpoint,
      timeoutMs: settings.uploadTimeoutMs,
      maxAttempts: settings.maxUploadAttempts,
      servingSettings: {
        assetServingMode: settings.assetServingMode,
        corsProxyEnabled: settings.corsProxyEnabled,
        corsProxyEndpoint: settings.corsProxyEndpoint,
        moduleServingStrategy: settings.moduleServingStrategy,
        selfContainedMaxInlineAssetKb: settings.selfContainedMaxInlineAssetKb
      }
    }
  };
  const prepared = await prepareThreeDJob(jobId, runnerDeps);
  if (prepared.job?.status === "preparing-3d") {
    await runPreparedThreeDJob(prepared.job.id, runnerDeps);
  }
}

async function runRewriteStage(jobId: string, deps: PipelineRunnerDeps): Promise<void> {
  const settings = await deps.settingsStore.get();
  const runnerDeps = {
    jobStore: deps.jobStore,
    blobStore: deps.blobStore,
    settings
  };
  const prepared = await prepareRewriteJob(jobId, runnerDeps);
  if (prepared.job?.status === "rewriting") {
    await runPreparedRewriteJob(prepared.job.id, runnerDeps);
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
      warnings: [...pipelineRun.warnings, `Continuando apos falha parcial: ${job.status}`],
      updatedAt: Date.now()
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
    errors: [...current.errors, message],
    updatedAt: Date.now()
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
    const role = asset.assetRole;
    const extensionMatch = value.match(/\.([a-z0-9]+)(?:[?#\s]|$)/i)?.[1]?.toLowerCase();
    const isDecoderOrModelPath = /(?:gltf|glb|model|scene|three|babylon|draco|basis|meshopt|ktx2|decoder|transcoder)/i.test(value);
    return Boolean(
      role === "gltf" ||
        role === "glb" ||
        role === "gltf-buffer" ||
        role === "ktx2-texture" ||
        role === "draco-compressed" ||
        role === "draco-decoder" ||
        role === "basis-transcoder" ||
        role === "meshopt-decoder" ||
        role === "model-viewer" ||
        extensionMatch === "gltf" ||
        extensionMatch === "glb" ||
        extensionMatch === "drc" ||
        extensionMatch === "ktx2" ||
        extensionMatch === "basis" ||
        extensionMatch === "hdr" ||
        extensionMatch === "exr" ||
        ((extensionMatch === "bin" || extensionMatch === "wasm" || role === "wasm" || role === "worker") && isDecoderOrModelPath)
    );
  });
}
