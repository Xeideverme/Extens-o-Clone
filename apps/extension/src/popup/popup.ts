import { EXTENSION_MESSAGE_TYPES } from "@clone3d/shared";
import type { AssetRecord, JobRecord, JobSummary } from "@clone3d/shared";

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
const assetCountEl = document.querySelector<HTMLElement>("#asset-count");
const jobUrlEl = document.querySelector<HTMLElement>("#job-url");
const downloadStatsEl = document.querySelector<HTMLElement>("#download-stats");
const uploadStatsEl = document.querySelector<HTMLElement>("#upload-stats");
const threeDStatsEl = document.querySelector<HTMLElement>("#three-d-stats");
const rewriteStatsEl = document.querySelector<HTMLElement>("#rewrite-stats");
const progressFillEl = document.querySelector<HTMLElement>("#progress-fill");
const assetListEl = document.querySelector<HTMLUListElement>("#asset-list");

type PollingMode = "download" | "upload" | "prepare3d" | "rewrite";

let currentJobId: string | undefined;
let pollingTimer: number | undefined;
let pollingMode: PollingMode = "download";

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

void loadLatestSummary();

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

async function loadLatestSummary(): Promise<void> {
  setStatus("Pronto");

  try {
    const response = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPES.getLatestJobSummary,
      payload: {}
    });

    renderSummary(response?.summary);
    if (response?.summary?.job?.status === "downloading") {
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
  }, 1000);
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
        : pollingMode === "prepare3d"
        ? EXTENSION_MESSAGE_TYPES.getPrepare3dProgress
        : pollingMode === "upload"
        ? EXTENSION_MESSAGE_TYPES.getUploadProgress
        : EXTENSION_MESSAGE_TYPES.getDownloadProgress,
    payload: {
      jobId: currentJobId
    }
  });

  renderSummary(response?.summary);
  const status = response?.summary?.job?.status;
  if (isTerminalStatus(status, pollingMode)) {
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

function renderSummary(summary?: JobSummary): void {
  const assets = summary?.assets ?? [];
  const job = summary?.job;
  currentJobId = job?.id;

  if (assetCountEl) {
    assetCountEl.textContent = String(assets.length);
  }

  if (jobUrlEl) {
    jobUrlEl.textContent = job?.pageUrl ? compactUrl(job.pageUrl) : "Nenhum job";
    jobUrlEl.title = job?.pageUrl ?? "";
  }

  renderDownloadStats(job);
  renderUploadStats(job);
  renderThreeDStats(job);
  renderRewriteStats(job);
  updateActions(job);

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

function renderThreeDStats(job: JobRecord | undefined): void {
  if (!threeDStatsEl) {
    return;
  }

  const report = job?.threeDPreparationReport || job?.output?.threeDPreparationReport;
  if (!report) {
    const assets3d = job ? "Aguardando preparacao 3D." : "Sem preparacao 3D.";
    threeDStatsEl.textContent = assets3d;
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

function renderRewriteStats(job: JobRecord | undefined): void {
  if (!rewriteStatsEl) {
    return;
  }

  const report = job?.rewriteReport || job?.output?.rewriteReport;
  if (!report) {
    rewriteStatsEl.textContent = "Sem app.html.";
    return;
  }

  rewriteStatsEl.textContent = [
    `app.html: ${report.outputFilename || job?.output?.fileName || "em andamento"}`,
    `html: ${report.htmlRewrites}`,
    `css: ${report.cssRewrites}`,
    `js: ${report.jsDirectRewrites}`,
    `json: ${report.jsonInlined}`,
    `pendentes: ${report.unresolvedUrls.length}`
  ].join(" | ");
}

function updateActions(job: JobRecord | undefined): void {
  const hasJob = Boolean(job);
  const status = job?.status;

  if (startDownloadsButton) {
    startDownloadsButton.disabled = !hasJob || status === "downloading" || status === "uploading" || status === "preparing-3d";
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
    prepare3dButton.disabled =
      !hasJob ||
      uploadedAssets <= 0 ||
      status === "downloading" ||
      status === "uploading" ||
      status === "preparing-3d" ||
      status === "rewriting";
  }

  if (cancelPrepare3dButton) {
    cancelPrepare3dButton.disabled = !hasJob || status !== "preparing-3d";
  }

  if (generateAppHtmlButton) {
    const uploadedAssets = job?.stats.uploadedAssets ?? 0;
    generateAppHtmlButton.disabled =
      !hasJob ||
      uploadedAssets <= 0 ||
      status === "downloading" ||
      status === "uploading" ||
      status === "preparing-3d" ||
      status === "rewriting";
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
