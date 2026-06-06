import { EXTENSION_MESSAGE_TYPES } from "@clone3d/shared";
import type { AssetRecord, JobRecord, JobStats, JobSummary } from "@clone3d/shared";

const statusEl = document.querySelector<HTMLElement>("#status");
const startButton = document.querySelector<HTMLButtonElement>("#start-capture");
const startDownloadsButton = document.querySelector<HTMLButtonElement>("#start-downloads");
const resumeDownloadsButton = document.querySelector<HTMLButtonElement>("#resume-downloads");
const cancelDownloadsButton = document.querySelector<HTMLButtonElement>("#cancel-downloads");
const assetCountEl = document.querySelector<HTMLElement>("#asset-count");
const jobUrlEl = document.querySelector<HTMLElement>("#job-url");
const downloadStatsEl = document.querySelector<HTMLElement>("#download-stats");
const progressFillEl = document.querySelector<HTMLElement>("#progress-fill");
const assetListEl = document.querySelector<HTMLUListElement>("#asset-list");

let currentJobId: string | undefined;
let pollingTimer: number | undefined;

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
    startPolling();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Falha ao iniciar downloads");
  } finally {
    setDownloadBusy(false);
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

async function loadLatestSummary(): Promise<void> {
  setStatus("Pronto");

  try {
    const response = await chrome.runtime.sendMessage({
      type: EXTENSION_MESSAGE_TYPES.getLatestJobSummary,
      payload: {}
    });

    renderSummary(response?.summary);
    if (response?.summary?.job?.status === "downloading") {
      startPolling();
    }
  } catch {
    renderSummary();
  }
}

function startPolling(): void {
  stopPolling();
  pollingTimer = window.setInterval(() => {
    void refreshDownloadProgress();
  }, 1000);
  void refreshDownloadProgress();
}

function stopPolling(): void {
  if (pollingTimer !== undefined) {
    window.clearInterval(pollingTimer);
    pollingTimer = undefined;
  }
}

async function refreshDownloadProgress(): Promise<void> {
  const response = await chrome.runtime.sendMessage({
    type: EXTENSION_MESSAGE_TYPES.getDownloadProgress,
    payload: {
      jobId: currentJobId
    }
  });

  renderSummary(response?.summary);
  const status = response?.summary?.job?.status;
  if (isTerminalStatus(status)) {
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
  const percent = stats ? progressPercent(stats) : 0;

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

function updateActions(job: JobRecord | undefined): void {
  const hasJob = Boolean(job);
  const status = job?.status;

  if (startDownloadsButton) {
    startDownloadsButton.disabled = !hasJob || status === "downloading";
  }

  if (resumeDownloadsButton) {
    resumeDownloadsButton.hidden = !(status === "partially-downloaded" || status === "failed");
    resumeDownloadsButton.disabled = status === "downloading";
  }

  if (cancelDownloadsButton) {
    cancelDownloadsButton.disabled = !hasJob || status !== "downloading";
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
    asset.sha256 ? `sha256:${asset.sha256.slice(0, 12)}` : undefined
  ]
    .filter(Boolean)
    .join(" | ");

  const source = document.createElement("span");
  source.className = "asset-source";
  source.textContent = asset.source.join(", ");

  item.append(name, url, meta, source);

  const issue = asset.lastError || asset.skippedReason || asset.error;
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

function progressPercent(stats: JobStats): number {
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

function isTerminalStatus(status: JobRecord["status"] | undefined): boolean {
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
    case "failed":
      return "Falhou";
    case "cancelled":
      return "Cancelado";
    default:
      return status ?? "Sem job";
  }
}
