import { EXTENSION_MESSAGE_TYPES } from "@clone3d/shared";
import type { AssetRecord, JobRecord, JobSummary } from "@clone3d/shared";
import { SettingsStore } from "../shared/settings-store";

const statusEl = document.querySelector<HTMLElement>("#status");
const startButton = document.querySelector<HTMLButtonElement>("#start-capture");
const startDownloadsButton = document.querySelector<HTMLButtonElement>("#start-downloads");
const resumeDownloadsButton = document.querySelector<HTMLButtonElement>("#resume-downloads");
const cancelDownloadsButton = document.querySelector<HTMLButtonElement>("#cancel-downloads");
const startUploadsButton = document.querySelector<HTMLButtonElement>("#start-uploads");
const resumeUploadsButton = document.querySelector<HTMLButtonElement>("#resume-uploads");
const cancelUploadsButton = document.querySelector<HTMLButtonElement>("#cancel-uploads");
const prepare3dButton = document.querySelector<HTMLButtonElement>("#prepare-3d");
const cancelPrepare3dButton = document.querySelector<HTMLButtonElement>("#cancel-prepare-3d");
const generateAppHtmlButton = document.querySelector<HTMLButtonElement>("#generate-app-html");
const startPipelineButton = document.querySelector<HTMLButtonElement>("#start-pipeline");
const resumePipelineButton = document.querySelector<HTMLButtonElement>("#resume-pipeline");
const cancelPipelineButton = document.querySelector<HTMLButtonElement>("#cancel-pipeline");
const assetCountEl = document.querySelector<HTMLElement>("#asset-count");
const jobUrlEl = document.querySelector<HTMLElement>("#job-url");
const downloadStatsEl = document.querySelector<HTMLElement>("#download-stats");
const uploadStatsEl = document.querySelector<HTMLElement>("#upload-stats");
const threeDStatsEl = document.querySelector<HTMLElement>("#three-d-stats");
const apiReplayStatsEl = document.querySelector<HTMLElement>("#api-replay-stats");
const pipelineStatsEl = document.querySelector<HTMLElement>("#pipeline-stats");
const rewriteStatsEl = document.querySelector<HTMLElement>("#rewrite-stats");
const corsDiagnosticsEl = document.querySelector<HTMLElement>("#cors-diagnostics");
const progressFillEl = document.querySelector<HTMLElement>("#progress-fill");
const assetListEl = document.querySelector<HTMLUListElement>("#asset-list");
const settingsStore = new SettingsStore();

type PollingMode = "download" | "upload" | "prepare3d" | "rewrite" | "pipeline";

let currentJobId: string | undefined;
let currentPipelineRunId: string | undefined;
let pollingTimer: number | undefined;
let pollingMode: PollingMode = "download";
let pollIntervalMs = 1000;
let currentSettings: Awaited<ReturnType<SettingsStore["get"]>> | undefined;

startButton?.addEventListener("click", () => {
  void startCapture();
});

startDownloadsButton?.addEventListener("click", () => {
  void startDownloads(EXTENSION_MESSAGE_TYPES.startDownloads);
});

resumeDownloadsButton?.addEventListener("click", () => {
  void startDownloads(EXTENSION_MESSAGE_TYPES.resumeDownloads);
});

cancelDownloadsButton?.addEventListener("click", () => {
  void cancelDownloads();
});

startUploadsButton?.addEventListener("click", () => {
  void startUploads(EXTENSION_MESSAGE_TYPES.startUploads);
});

resumeUploadsButton?.addEventListener("click", () => {
  void startUploads(EXTENSION_MESSAGE_TYPES.resumeUploads);
});

cancelUploadsButton?.addEventListener("click", () => {
  void cancelUploads();
});

prepare3dButton?.addEventListener("click", () => {
  void prepare3dAssets();
});

cancelPrepare3dButton?.addEventListener("click", () => {
  void cancelPrepare3d();
});

generateAppHtmlButton?.addEventListener("click", () => {
  void generateAppHtml();
});

startPipelineButton?.addEventListener("click", () => {
  void startPipeline(EXTENSION_MESSAGE_TYPES.startFullPipeline);
});

resumePipelineButton?.addEventListener("click", () => {
  void startPipeline(EXTENSION_MESSAGE_TYPES.resumePipeline);
});

cancelPipelineButton?.addEventListener("click", () => {
  void cancelPipeline();
});

void loadPopupSettings();
void loadLatestSummary();

async function loadPopupSettings(): Promise<void> {
  try {
    const settings = await settingsStore.get();
    currentSettings = settings;
    pollIntervalMs = settings.pipelinePollIntervalMs;
  } catch {
    pollIntervalMs = 1000;
  }
}

async function startCapture(): Promise<void> {
  setCaptureBusy(true);
  setStatus("Capturando...");

  try {
    const tabId = await getCaptureTabId();
    const response = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPES.startCapture,
      payload: {
        tabId
      }
    });

    if (!response?.ok) {
      setStatus(response?.message || "Falha na captura");
      renderSummary(response?.summary);
      return;
    }

    setStatus("Captura concluida");
    renderSummary(response.summary);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Falha na captura");
  } finally {
    setCaptureBusy(false);
  }
}

async function startDownloads(type: string): Promise<void> {
  setDownloadBusy(true);
  setStatus("Baixando assets...");

  try {
    const response = await chrome.runtime.sendMessage({
      type,
      payload: {
        jobId: currentJobId
      }
    });

    if (!response?.ok) {
      setStatus(response?.error || "Falha ao iniciar downloads");
      renderSummary(response?.summary);
      return;
    }

    renderSummary(response.summary);
    startPolling("download");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Falha ao iniciar downloads");
  } finally {
    setDownloadBusy(false);
  }
}

async function startUploads(type: string): Promise<void> {
  setUploadBusy(true);
  setStatus("Enviando assets...");

  try {
    const response = await chrome.runtime.sendMessage({
      type,
      payload: {
        jobId: currentJobId
      }
    });

    if (!response?.ok) {
      setStatus(uploadErrorToLabel(response?.error));
      renderSummary(response?.summary);
      return;
    }

    renderSummary(response.summary);
    if (response.summary?.job?.status === "uploading") {
      startPolling("upload");
    } else {
      setStatus(statusToLabel(response.summary?.job?.status));
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Falha ao iniciar uploads");
  } finally {
    setUploadBusy(false);
  }
}

async function cancelDownloads(): Promise<void> {
  if (!currentJobId) {
    return;
  }

  setStatus("Cancelando...");

  const response = await chrome.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPES.cancelDownloads,
    payload: {
      jobId: currentJobId
    }
  });

  stopPolling();
  renderSummary(response?.summary);
  setStatus(response?.ok ? "Cancelado" : "Falha ao cancelar");
}

async function cancelUploads(): Promise<void> {
  if (!currentJobId) {
    return;
  }

  setStatus("Cancelando uploads...");

  const response = await chrome.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPES.cancelUploads,
    payload: {
      jobId: currentJobId
    }
  });

  stopPolling();
  renderSummary(response?.summary);
  setStatus(response?.ok ? "Uploads cancelados" : "Falha ao cancelar uploads");
}

async function prepare3dAssets(): Promise<void> {
  if (!currentJobId) {
    return;
  }

  setPrepare3dBusy(true);
  setStatus("Preparando assets 3D...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPES.prepare3dAssets,
      payload: {
        jobId: currentJobId
      }
    });

    if (!response?.ok) {
      setStatus(response?.error || "Falha ao preparar 3D");
      renderSummary(response?.summary);
      return;
    }

    renderSummary(response.summary);
    if (response.summary?.job?.status === "preparing-3d") {
      startPolling("prepare3d");
    } else {
      setStatus(statusToLabel(response.summary?.job?.status));
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Falha ao preparar 3D");
  } finally {
    setPrepare3dBusy(false);
  }
}

async function cancelPrepare3d(): Promise<void> {
  if (!currentJobId) {
    return;
  }

  setStatus("Cancelando preparacao 3D...");

  const response = await chrome.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPES.cancelPrepare3d,
    payload: {
      jobId: currentJobId
    }
  });

  stopPolling();
  renderSummary(response?.summary);
  setStatus(response?.ok ? "Preparacao 3D cancelada" : "Falha ao cancelar preparacao 3D");
}

async function generateAppHtml(): Promise<void> {
  if (!currentJobId) {
    return;
  }

  setRewriteBusy(true);
  setStatus("Gerando app.html...");

  try {
    const response = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPES.generateAppHtml,
      payload: {
        jobId: currentJobId
      }
    });

    if (!response?.ok) {
      setStatus(response?.error || "Falha ao gerar app.html");
      renderSummary(response?.summary);
      return;
    }

    renderSummary(response.summary);
    if (response.summary?.job?.status === "rewriting") {
      startPolling("rewrite");
    } else {
      setStatus(statusToLabel(response.summary?.job?.status));
    }
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Falha ao gerar app.html");
  } finally {
    setRewriteBusy(false);
  }
}

async function startPipeline(type: string): Promise<void> {
  setPipelineBusy(true);
  setStatus(type === EXTENSION_MESSAGE_TYPES.resumePipeline ? "Retomando pipeline..." : "Executando pipeline...");

  try {
    const tabId = await getCaptureTabId();
    const response = await chrome.runtime.sendMessage({
      type,
      payload: {
        pipelineRunId: currentPipelineRunId,
        jobId: currentJobId,
        tabId
      }
    });

    if (!response?.ok) {
      setStatus(response?.error || "Falha ao iniciar pipeline");
      renderSummary(response?.summary);
      return;
    }

    currentPipelineRunId = response.pipelineRun?.id ?? response.summary?.pipelineRun?.id;
    renderSummary(response.summary);
    startPolling("pipeline");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Falha ao iniciar pipeline");
  } finally {
    setPipelineBusy(false);
  }
}

async function cancelPipeline(): Promise<void> {
  if (!currentPipelineRunId && !currentJobId) {
    return;
  }

  setStatus("Cancelando pipeline...");
  const response = await chrome.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPES.cancelPipeline,
    payload: {
      pipelineRunId: currentPipelineRunId,
      jobId: currentJobId
    }
  });

  stopPolling();
  renderSummary(response?.summary);
  setStatus(response?.ok ? "Pipeline cancelado" : "Falha ao cancelar pipeline");
}

async function loadLatestSummary(): Promise<void> {
  setStatus("Pronto");

  try {
    const response = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPES.getLatestJobSummary,
      payload: {}
    });

    renderSummary(response?.summary);
    if (response?.summary?.pipelineRun?.status === "running") {
      startPolling("pipeline");
    } else if (response?.summary?.job?.status === "downloading") {
      startPolling("download");
    } else if (response?.summary?.job?.status === "uploading") {
      startPolling("upload");
    } else if (response?.summary?.job?.status === "preparing-3d") {
      startPolling("prepare3d");
    } else if (response?.summary?.job?.status === "rewriting") {
      startPolling("rewrite");
    }
  } catch {
    renderSummary();
  }
}

function startPolling(mode: PollingMode): void {
  stopPolling();
  pollingMode = mode;
  pollingTimer = window.setInterval(() => {
    void refreshProgress();
  }, pollIntervalMs);
  void refreshProgress();
}

function stopPolling(): void {
  if (pollingTimer !== undefined) {
    window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
}

async function refreshProgress(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type:
      pollingMode === "rewrite"
        ? EXTENSION_MESSAGE_TYPES.getRewriteProgress
        : pollingMode === "pipeline"
        ? EXTENSION_MESSAGE_TYPES.getPipelineProgress
        : pollingMode === "prepare3d"
        ? EXTENSION_MESSAGE_TYPES.getPrepare3dProgress
        : pollingMode === "upload"
        ? EXTENSION_MESSAGE_TYPES.getUploadProgress
        : EXTENSION_MESSAGE_TYPES.getDownloadProgress,
    payload: {
      jobId: currentJobId,
      pipelineRunId: currentPipelineRunId
    }
  });

  renderSummary(response?.summary);
  currentPipelineRunId = response?.pipelineRun?.id ?? response?.summary?.pipelineRun?.id ?? currentPipelineRunId;
  const status = response?.summary?.job?.status;
  const pipelineStatus = response?.pipelineRun?.status ?? response?.summary?.pipelineRun?.status;
  if (pollingMode === "pipeline" && pipelineStatus && pipelineStatus !== "running") {
    stopPolling();
    setStatus(pipelineStatus === "completed" ? "Pipeline concluido" : pipelineStatus === "cancelled" ? "Pipeline cancelado" : "Pipeline falhou");
  } else if (isTerminalStatus(status, pollingMode)) {
    stopPolling();
    setStatus(statusToLabel(status));
  } else if (status) {
    setStatus(statusToLabel(status));
  }
}

async function getCaptureTabId(): Promise<number | undefined> {
  const [activeTab] = await chrome.tabs.query({
    active: true,
    currentWindow: true
  });

  if (activeTab?.id && isCaptureCandidate(activeTab.url)) {
    return activeTab.id;
  }

  const tabs = await chrome.tabs.query({
    currentWindow: true
  });

  return tabs.reverse().find((tab) => tab.id && isCaptureCandidate(tab.url))?.id;
}

function isCaptureCandidate(url: string | undefined): boolean {
  return Boolean(
    url &&
      !url.startsWith("chrome-extension://") &&
      !url.startsWith("chrome://") &&
      !url.startsWith("edge://") &&
      !url.startsWith("about:")
  );
}

function setStatus(value: string): void {
  if (statusEl) {
    statusEl.textContent = value;
  }
}

function setCaptureBusy(value: boolean): void {
  if (startButton) {
    startButton.disabled = value;
    startButton.textContent = value ? "Capturando..." : "Iniciar captura";
  }
}

function setDownloadBusy(value: boolean): void {
  if (startDownloadsButton) {
    startDownloadsButton.disabled = value;
  }

  if (resumeDownloadsButton) {
    resumeDownloadsButton.disabled = value;
  }
}

function setUploadBusy(value: boolean): void {
  if (startUploadsButton) {
    startUploadsButton.disabled = value;
  }

  if (resumeUploadsButton) {
    resumeUploadsButton.disabled = value;
  }
}

function setPrepare3dBusy(value: boolean): void {
  if (prepare3dButton) {
    prepare3dButton.disabled = value;
  }

  if (cancelPrepare3dButton) {
    cancelPrepare3dButton.disabled = value;
  }
}

function setRewriteBusy(value: boolean): void {
  if (generateAppHtmlButton) {
    generateAppHtmlButton.disabled = value;
  }
}

function setPipelineBusy(value: boolean): void {
  if (startPipelineButton) {
    startPipelineButton.disabled = value;
  }

  if (resumePipelineButton) {
    resumePipelineButton.disabled = value;
  }
}

function renderSummary(summary?: JobSummary): void {
  const assets = summary?.assets ?? [];
  const job = summary?.job;
  currentJobId = job?.id;
  currentPipelineRunId = summary?.pipelineRun?.id ?? job?.pipelineRun?.id ?? currentPipelineRunId;

  if (assetCountEl) {
    assetCountEl.textContent = String(assets.length);
  }

  if (jobUrlEl) {
    jobUrlEl.textContent = job?.pageUrl ? compactUrl(job.pageUrl) : "Nenhum job";
    jobUrlEl.title = job?.pageUrl ?? "";
  }

  renderDownloadStats(job);
  renderUploadStats(job);
  renderThreeDStats(job, assets);
  renderApiReplayStats(summary);
  renderPipelineStats(summary);
  renderRewriteStats(job);
  renderCorsDiagnostics(job);
  updateActions(job, assets, summary?.pipelineRun);

  if (!assetListEl) {
    return;
  }

  assetListEl.replaceChildren();

  if (assets.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "Nenhum asset capturado ainda.";
    assetListEl.appendChild(empty);
    return;
  }

  for (const asset of assets) {
    assetListEl.appendChild(renderAsset(asset));
  }
}

function renderDownloadStats(job: JobRecord | undefined): void {
  const stats = job?.stats;
  const percent = job ? progressPercent(job) : 0;

  if (progressFillEl) {
    progressFillEl.style.width = `${percent}%`;
  }

  if (!downloadStatsEl) {
    return;
  }

  if (!stats) {
    downloadStatsEl.textContent = "Sem downloads.";
    return;
  }

  downloadStatsEl.textContent = [
    `job: ${statusToLabel(job?.status)}`,
    `baixados: ${stats.downloadedAssets}/${stats.totalAssets}`,
    `falhas: ${stats.failedAssets}`,
    `pulados: ${stats.skippedAssets}`,
    `bytes: ${formatBytes(stats.downloadedBytes)}`
  ].join(" | ");
}

function renderUploadStats(job: JobRecord | undefined): void {
  const stats = job?.stats;
  if (!uploadStatsEl) {
    return;
  }

  if (!stats || stats.downloadedAssets <= 0) {
    uploadStatsEl.textContent = "Sem uploads.";
    return;
  }

  uploadStatsEl.textContent = [
    `uploads: ${stats.uploadedAssets}/${stats.downloadedAssets}`,
    `falhas: ${stats.failedAssets}`,
    `bytes enviados: ${formatBytes(stats.totalUploadedBytes)}`,
    `progresso: ${job ? progressPercent(job) : 0}%`
  ].join(" | ");
}

function renderThreeDStats(job: JobRecord | undefined, assets: AssetRecord[]): void {
  if (!threeDStatsEl) {
    return;
  }

  const report = job?.threeDPreparationReport || job?.output?.threeDPreparationReport;
  if (!report) {
    threeDStatsEl.textContent = job && !hasLikelyThreeDAssets(job, assets)
      ? "Nenhum asset 3D detectado. Preparacao 3D sera pulada."
      : job
        ? "Aguardando preparacao 3D."
        : "Sem preparacao 3D.";
    return;
  }

  threeDStatsEl.textContent = [
    `3D: ${report.detected3dAssets}`,
    `gltf: ${report.gltfFilesAnalyzed}/${report.gltfFilesRewritten}`,
    `derivados: ${report.derivedAssetsUploaded}`,
    `decoders: ${report.decoderAssetsDetected}`,
    `workers: ${report.workerAssetsDetected}`,
    `wasm: ${report.wasmAssetsDetected}`,
    `pendentes: ${report.unresolvedGltfUris.length + report.unresolvedDecoderUrls.length + report.unresolvedWorkerUrls.length}`,
    `avisos: ${report.warnings.length}`
  ].join(" | ");
}

function renderApiReplayStats(summary: JobSummary | undefined): void {
  if (!apiReplayStatsEl) {
    return;
  }

  const report = summary?.apiReplayReport || summary?.job?.apiReplayReport || summary?.job?.output?.apiReplayReport;
  const snapshots = summary?.apiSnapshots ?? [];
  if (!report && snapshots.length === 0) {
    apiReplayStatsEl.textContent = "API Replay: ativo por padrao, sem snapshots.";
    return;
  }

  const replayable = snapshots.filter((snapshot) => snapshot.replayable).length;
  apiReplayStatsEl.textContent = [
    `API Replay: ${snapshots.length} snapshots`,
    `replayable: ${replayable}`,
    `capturados: ${report?.capturedResponses ?? snapshots.length}`,
    `sensivel: ${report?.skippedSensitive ?? 0}`,
    `grande: ${report?.skippedTooLarge ?? 0}`,
    `tipo nao suportado: ${report?.skippedUnsupportedContentType ?? 0}`
  ].join(" | ");
}

function renderPipelineStats(summary: JobSummary | undefined): void {
  if (!pipelineStatsEl) {
    return;
  }

  const pipelineRun = summary?.pipelineRun || summary?.job?.pipelineRun;
  if (!pipelineRun) {
    pipelineStatsEl.textContent = "Pipeline: ocioso.";
    return;
  }

  pipelineStatsEl.textContent = [
    `Pipeline: ${pipelineRun.status}`,
    `etapa: ${pipelineRun.stage}`,
    pipelineRun.currentStepLabel,
    pipelineRun.warnings.length > 0 ? `avisos: ${pipelineRun.warnings.length}` : undefined,
    pipelineRun.errors.length > 0 ? `erros: ${pipelineRun.errors.length}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");
}

function renderRewriteStats(job: JobRecord | undefined): void {
  if (!rewriteStatsEl) {
    return;
  }

  const report = job?.rewriteReport || job?.output?.rewriteReport;
  if (!report) {
    rewriteStatsEl.textContent = currentSettings?.corsProxyEnabled
      ? `Sem app.html. CORS proxy: ${currentSettings.corsProxyEndpoint || "sem endpoint"}`
      : "Sem app.html. Catbox direto pode falhar para modules/WASM/GLTF sem CORS proxy.";
    return;
  }

  const validation = report.validationReport;
  const criticalMissing = report.criticalAssetsMissing ?? validation?.criticalAssetsMissing ?? [];
  const jobError = job?.lastError || job?.errors.at(-1)?.message;
  rewriteStatsEl.textContent = [
    `app.html: ${report.outputFilename || job?.output?.fileName || "em andamento"}`,
    job?.status === "rewrite-failed" && jobError ? `erro: ${jobError}` : undefined,
    `html: ${report.htmlRewrites}`,
    `css: ${report.cssRewrites}`,
    `js: ${report.jsDirectRewrites}`,
    `json: ${report.jsonInlined}`,
    `pendentes: ${report.unresolvedUrls.length}`,
    validation ? `validator: ${validation.ok ? "ok" : "erro"}` : undefined,
    validation?.catboxDirectCorsRisks.length ? `catbox CORS: ${validation.catboxDirectCorsRisks.length}` : undefined,
    validation?.nextImageUnresolved.length ? `next image: ${validation.nextImageUnresolved.length}` : undefined,
    criticalMissing.length ? `criticos faltando: ${criticalMissing.length}` : undefined,
    criticalMissing.length ? `primeiros: ${criticalMissing.slice(0, 10).map(compactUrl).join(", ")}` : undefined,
    currentSettings?.corsProxyEnabled ? "proxy: sim" : "proxy: nao"
  ].join(" | ");
}

function renderCorsDiagnostics(job: JobRecord | undefined): void {
  if (!corsDiagnosticsEl) {
    return;
  }

  const report = job?.rewriteReport || job?.output?.rewriteReport;
  const validation = report?.validationReport;
  corsDiagnosticsEl.textContent = [
    "CORS/Catbox/Next:",
    `proxy: ${currentSettings?.corsProxyEnabled ? "sim" : "nao"}`,
    currentSettings?.corsProxyEndpoint ? `endpoint: ${compactUrl(currentSettings.corsProxyEndpoint)}` : undefined,
    currentSettings?.assetServingMode ? `serving: ${currentSettings.assetServingMode}` : undefined,
    currentSettings?.moduleServingStrategy ? `modules: ${currentSettings.moduleServingStrategy}` : undefined,
    validation ? `validator: ${validation.ok ? "ok" : "erro"}` : "validator: pendente",
    validation?.catboxDirectCorsRisks.length ? `Catbox direto: ${validation.catboxDirectCorsRisks.length}` : undefined,
    validation?.dynamicImportsDirectToCatbox.length ? `dynamic imports: ${validation.dynamicImportsDirectToCatbox.length}` : undefined,
    validation?.nextImageUnresolved.length ? `Next image pendente: ${validation.nextImageUnresolved.length}` : undefined,
    validation?.criticalAssetsMissing.length ? `criticos faltando: ${validation.criticalAssetsMissing.length}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");
}

function updateActions(job: JobRecord | undefined, assets: AssetRecord[], summaryPipelineRun: JobSummary["pipelineRun"]): void {
  const hasJob = Boolean(job);
  const status = job?.status;
  const pipelineRun = summaryPipelineRun || job?.pipelineRun;
  const pipelineRunning = pipelineRun?.status === "running";
  const has3dAssets = hasLikelyThreeDAssets(job, assets);

  if (startDownloadsButton) {
    startDownloadsButton.disabled = pipelineRunning || !hasJob || status === "downloading" || status === "uploading" || status === "preparing-3d";
  }

  if (resumeDownloadsButton) {
    resumeDownloadsButton.hidden = !(status === "partially-downloaded" || status === "failed");
    resumeDownloadsButton.disabled = status === "downloading" || status === "uploading" || status === "preparing-3d";
  }

  if (cancelDownloadsButton) {
    cancelDownloadsButton.disabled = !hasJob || status !== "downloading";
  }

  if (startUploadsButton) {
    startUploadsButton.disabled =
      pipelineRunning ||
      !hasJob ||
      status === "downloading" ||
      status === "uploading" ||
      status === "preparing-3d" ||
      (job?.stats.downloadedAssets ?? 0) <= 0;
  }

  if (resumeUploadsButton) {
    resumeUploadsButton.hidden = !(status === "partially-uploaded" || status === "failed" || status === "cancelled");
    resumeUploadsButton.disabled = status === "uploading" || status === "preparing-3d" || (job?.stats.downloadedAssets ?? 0) <= 0;
  }

  if (cancelUploadsButton) {
    cancelUploadsButton.disabled = !hasJob || status !== "uploading";
  }

  if (prepare3dButton) {
    const uploadedAssets = job?.stats.uploadedAssets ?? 0;
    prepare3dButton.hidden = !has3dAssets && status !== "preparing-3d";
    prepare3dButton.disabled =
      pipelineRunning ||
      !hasJob ||
      !has3dAssets ||
      uploadedAssets <= 0 ||
      status === "downloading" ||
      status === "uploading" ||
      status === "preparing-3d" ||
      status === "rewriting";
  }

  if (cancelPrepare3dButton) {
    cancelPrepare3dButton.hidden = status !== "preparing-3d";
    cancelPrepare3dButton.disabled = !hasJob || status !== "preparing-3d";
  }

  if (generateAppHtmlButton) {
    const uploadedAssets = job?.stats.uploadedAssets ?? 0;
    generateAppHtmlButton.disabled =
      pipelineRunning ||
      !hasJob ||
      uploadedAssets <= 0 ||
      status === "downloading" ||
      status === "uploading" ||
      status === "preparing-3d" ||
      status === "rewriting";
  }

  if (startPipelineButton) {
    startPipelineButton.disabled = pipelineRunning;
  }

  if (resumePipelineButton) {
    resumePipelineButton.hidden = !(pipelineRun?.status === "failed" || pipelineRun?.status === "cancelled");
    resumePipelineButton.disabled = pipelineRunning;
  }

  if (cancelPipelineButton) {
    cancelPipelineButton.disabled = !pipelineRunning;
  }
}

function renderAsset(asset: AssetRecord): HTMLLIElement {
  const item = document.createElement("li");
  item.className = `asset-item status-${asset.status}`;

  const name = document.createElement("span");
  name.className = "asset-name";
  name.textContent = getAssetName(asset.normalizedUrl);
  name.title = asset.normalizedUrl;

  const url = document.createElement("span");
  url.className = "asset-url";
  url.textContent = compactUrl(asset.normalizedUrl);
  url.title = asset.normalizedUrl;

  const meta = document.createElement("span");
  meta.className = "asset-meta";
  meta.textContent = [
    asset.status,
    asset.size !== undefined ? formatBytes(asset.size) : undefined,
    asset.contentType,
    asset.assetRole ? `role:${asset.assetRole}` : undefined,
    asset.threeDPrepared ? "3d:prepared" : undefined,
    asset.sha256 ? `sha256:${asset.sha256.slice(0, 12)}` : undefined,
    asset.publicUrl ? `public:${compactUrl(asset.publicUrl)}` : undefined,
    asset.originalPublicUrl ? `original:${compactUrl(asset.originalPublicUrl)}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");

  const source = document.createElement("span");
  source.className = "asset-source";
  source.textContent = asset.source.join(", ");

  item.append(name, url, meta, source);

  if (asset.publicUrl) {
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "asset-copy";
    copyButton.textContent = "Copiar publicUrl";
    copyButton.addEventListener("click", () => {
      void navigator.clipboard.writeText(asset.publicUrl ?? "");
    });
    item.appendChild(copyButton);
  }

  const issue =
    asset.lastError ||
    asset.skippedReason ||
    asset.error ||
    (asset.threeDPreparationWarnings && asset.threeDPreparationWarnings.length > 0
      ? asset.threeDPreparationWarnings.join("; ")
      : undefined);
  if (issue) {
    const error = document.createElement("span");
    error.className = "asset-error";
    error.textContent = issue;
    item.appendChild(error);
  }

  return item;
}

function hasLikelyThreeDAssets(job: JobRecord | undefined, assets: AssetRecord[]): boolean {
  if ((job?.threeDPreparationReport?.detected3dAssets ?? 0) > 0) {
    return true;
  }

  return assets.some((asset) => {
    if (asset.isDerivedAsset) {
      return false;
    }

    if (
      asset.assetRole &&
      ["gltf", "glb", "gltf-buffer", "ktx2-texture", "draco-compressed", "draco-decoder", "basis-transcoder", "meshopt-decoder", "wasm", "worker", "model-viewer"].includes(asset.assetRole)
    ) {
      return true;
    }

    const value = `${asset.normalizedUrl} ${asset.originalUrl}`.toLowerCase();
    const isDecoderOrModelPath = /(?:gltf|glb|model|scene|three|babylon|draco|basis|meshopt|ktx2|decoder|transcoder)/i.test(value);
    return (
      /\.(gltf|glb|drc|ktx2|basis|hdr|exr)(?:[?#\s]|$)/i.test(value) ||
      /\.(bin|wasm)(?:[?#\s]|$)/i.test(value) && isDecoderOrModelPath ||
      /(?:draco|basis_transcoder|meshopt|ktx2loader|dracoloader)/i.test(value)
    );
  });
}

function getAssetName(value: string): string {
  try {
    const url = new URL(value);
    const lastSegment = url.pathname.split("/").filter(Boolean).at(-1);
    return lastSegment || url.hostname || value.slice(0, 48);
  } catch {
    return value.slice(0, 48);
  }
}

function compactUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "data:") {
      return `${url.protocol}${value.slice(5, 64)}...`;
    }

    return `${url.host}${url.pathname}${url.search}`;
  } catch {
    return value;
  }
}

function progressPercent(job: JobRecord): number {
  const stats = job.stats;
  if (job.status === "rewriting") {
    return 100;
  }

  if (job.status === "preparing-3d" || job.status === "prepared-3d" || job.status === "partially-prepared-3d") {
    const report = job.threeDPreparationReport;
    if (!report || report.detected3dAssets <= 0) {
      return job.status === "preparing-3d" ? 20 : 100;
    }

    const preparedAssets = report.gltfFilesRewritten + report.derivedAssetsUploaded;
    return Math.min(100, Math.max(20, Math.round((preparedAssets / report.detected3dAssets) * 100)));
  }

  if (job.status === "uploading" || job.status === "uploaded" || job.status === "partially-uploaded") {
    if (stats.downloadedAssets <= 0) {
      return 0;
    }

    return Math.round((stats.uploadedAssets / stats.downloadedAssets) * 100);
  }

  if (stats.totalAssets <= 0) {
    return 0;
  }

  return Math.round(((stats.downloadedAssets + stats.failedAssets + stats.skippedAssets) / stats.totalAssets) * 100);
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  if (value < 1024 * 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }

  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function isTerminalStatus(status: JobRecord["status"] | undefined, mode: PollingMode): boolean {
  if (mode === "rewrite") {
    return status === "rewritten" || status === "rewrite-failed" || status === "failed" || status === "cancelled";
  }

  if (mode === "prepare3d") {
    return (
      status === "prepared-3d" ||
      status === "partially-prepared-3d" ||
      status === "prepare-3d-failed" ||
      status === "failed" ||
      status === "cancelled"
    );
  }

  if (mode === "upload") {
    return status === "uploaded" || status === "partially-uploaded" || status === "failed" || status === "cancelled";
  }

  return status === "downloaded" || status === "partially-downloaded" || status === "failed" || status === "cancelled";
}

function statusToLabel(status: string | undefined): string {
  switch (status) {
    case "captured":
      return "Capturado";
    case "downloading":
      return "Baixando";
    case "downloaded":
      return "Download concluido";
    case "partially-downloaded":
      return "Download parcial";
    case "uploading":
      return "Enviando";
    case "uploaded":
      return "Upload concluido";
    case "partially-uploaded":
      return "Upload parcial";
    case "preparing-3d":
      return "Preparando 3D";
    case "prepared-3d":
      return "3D preparado";
    case "partially-prepared-3d":
      return "3D parcialmente preparado";
    case "prepare-3d-failed":
      return "Falha ao preparar 3D";
    case "rewriting":
      return "Gerando app.html";
    case "rewritten":
      return "app.html gerado";
    case "rewrite-failed":
      return "Falha ao gerar app.html";
    case "failed":
      return "Falhou";
    case "cancelled":
      return "Cancelado";
    default:
      return status ?? "Sem job";
  }
}

function uploadErrorToLabel(error: string | undefined): string {
  switch (error) {
    case "catbox_endpoint_required":
      return "Configure o endpoint Catbox nas opcoes";
    default:
      return error || "Falha ao iniciar uploads";
  }
}
