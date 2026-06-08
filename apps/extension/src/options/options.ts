import { DEFAULT_UPLOAD_CONCURRENCY } from "@clone3d/shared";
import type { AssetServingMode, ModuleServingStrategy } from "@clone3d/shared";
import { SettingsStore } from "../shared/settings-store";

const form = document.querySelector<HTMLFormElement>("#settings-form");
const catboxUploadEndpointInput = document.querySelector<HTMLInputElement>("#catbox-upload-endpoint");
const thresholdInput = document.querySelector<HTMLInputElement>("#inline-threshold");
const downloadConcurrencyInput = document.querySelector<HTMLInputElement>("#download-concurrency");
const downloadTimeoutInput = document.querySelector<HTMLInputElement>("#download-timeout");
const maxDownloadAttemptsInput = document.querySelector<HTMLInputElement>("#max-download-attempts");
const uploadConcurrencyInput = document.querySelector<HTMLInputElement>("#upload-concurrency");
const uploadTimeoutInput = document.querySelector<HTMLInputElement>("#upload-timeout");
const maxUploadAttemptsInput = document.querySelector<HTMLInputElement>("#max-upload-attempts");
const generateHtmlSaveAsInput = document.querySelector<HTMLInputElement>("#generate-html-save-as");
const includeRewriteReportInput = document.querySelector<HTMLInputElement>("#include-rewrite-report");
const runtimeResolverEnabledInput = document.querySelector<HTMLInputElement>("#runtime-resolver-enabled");
const apiReplayEnabledInput = document.querySelector<HTMLInputElement>("#api-replay-enabled");
const apiReplayMaxBodyInput = document.querySelector<HTMLInputElement>("#api-replay-max-body");
const apiReplaySameOriginInput = document.querySelector<HTMLInputElement>("#api-replay-same-origin");
const apiReplayTextPlainInput = document.querySelector<HTMLInputElement>("#api-replay-text-plain");
const pipelineContinuePartialInput = document.querySelector<HTMLInputElement>("#pipeline-continue-partial");
const pipelineAutoPrepare3dInput = document.querySelector<HTMLInputElement>("#pipeline-auto-prepare-3d");
const pipelineAutoGenerateHtmlInput = document.querySelector<HTMLInputElement>("#pipeline-auto-generate-html");
const pipelinePollIntervalInput = document.querySelector<HTMLInputElement>("#pipeline-poll-interval");
const assetServingModeInput = document.querySelector<HTMLSelectElement>("#asset-serving-mode");
const corsProxyEnabledInput = document.querySelector<HTMLInputElement>("#cors-proxy-enabled");
const corsProxyEndpointInput = document.querySelector<HTMLInputElement>("#cors-proxy-endpoint");
const moduleServingStrategyInput = document.querySelector<HTMLSelectElement>("#module-serving-strategy");
const selfContainedMaxInlineInput = document.querySelector<HTMLInputElement>("#self-contained-max-inline");
const allowCriticalMissingInput = document.querySelector<HTMLInputElement>("#allow-critical-missing");
const saveStatus = document.querySelector<HTMLParagraphElement>("#save-status");
const settingsStore = new SettingsStore();

void loadSettings();

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

async function loadSettings(): Promise<void> {
  const settings = await settingsStore.get();

  if (catboxUploadEndpointInput) {
    catboxUploadEndpointInput.value = settings.catboxUploadEndpoint;
  }

  if (thresholdInput) {
    thresholdInput.value = String(settings.inlineThresholdKb);
  }

  if (downloadConcurrencyInput) {
    downloadConcurrencyInput.value = String(settings.downloadConcurrency);
  }

  if (downloadTimeoutInput) {
    downloadTimeoutInput.value = String(settings.downloadTimeoutMs);
  }

  if (maxDownloadAttemptsInput) {
    maxDownloadAttemptsInput.value = String(settings.maxDownloadAttempts);
  }

  if (uploadConcurrencyInput) {
    uploadConcurrencyInput.value = String(settings.uploadConcurrency);
  }

  if (uploadTimeoutInput) {
    uploadTimeoutInput.value = String(settings.uploadTimeoutMs);
  }

  if (maxUploadAttemptsInput) {
    maxUploadAttemptsInput.value = String(settings.maxUploadAttempts);
  }

  if (generateHtmlSaveAsInput) {
    generateHtmlSaveAsInput.checked = settings.generateHtmlSaveAs;
  }

  if (includeRewriteReportInput) {
    includeRewriteReportInput.checked = settings.includeRewriteReportInHtml;
  }

  if (runtimeResolverEnabledInput) {
    runtimeResolverEnabledInput.checked = settings.runtimeResolverEnabled;
  }

  if (apiReplayEnabledInput) {
    apiReplayEnabledInput.checked = settings.apiReplayEnabled;
  }

  if (apiReplayMaxBodyInput) {
    apiReplayMaxBodyInput.value = String(settings.apiReplayMaxBodyKb);
  }

  if (apiReplaySameOriginInput) {
    apiReplaySameOriginInput.checked = settings.apiReplayCaptureSameOriginOnly;
  }

  if (apiReplayTextPlainInput) {
    apiReplayTextPlainInput.checked = settings.apiReplayAllowTextPlain;
  }

  if (pipelineContinuePartialInput) {
    pipelineContinuePartialInput.checked = settings.pipelineContinueOnPartialFailure;
  }

  if (pipelineAutoPrepare3dInput) {
    pipelineAutoPrepare3dInput.checked = settings.pipelineAutoPrepare3d;
  }

  if (pipelineAutoGenerateHtmlInput) {
    pipelineAutoGenerateHtmlInput.checked = settings.pipelineAutoGenerateHtml;
  }

  if (pipelinePollIntervalInput) {
    pipelinePollIntervalInput.value = String(settings.pipelinePollIntervalMs);
  }

  if (assetServingModeInput) {
    assetServingModeInput.value = settings.assetServingMode;
  }

  if (corsProxyEnabledInput) {
    corsProxyEnabledInput.checked = settings.corsProxyEnabled;
  }

  if (corsProxyEndpointInput) {
    corsProxyEndpointInput.value = settings.corsProxyEndpoint;
  }

  if (moduleServingStrategyInput) {
    moduleServingStrategyInput.value = settings.moduleServingStrategy;
  }

  if (selfContainedMaxInlineInput) {
    selfContainedMaxInlineInput.value = String(settings.selfContainedMaxInlineAssetKb);
  }

  if (allowCriticalMissingInput) {
    allowCriticalMissingInput.checked = settings.allowGenerateWithCriticalMissingAssets;
  }
}

async function saveSettings(): Promise<void> {
  await settingsStore.set({
    catboxUploadEndpoint: catboxUploadEndpointInput?.value.trim() ?? "",
    inlineThresholdKb: Number(thresholdInput?.value || 50),
    downloadConcurrency: Number(downloadConcurrencyInput?.value || 4),
    downloadTimeoutMs: Number(downloadTimeoutInput?.value || 30000),
    maxDownloadAttempts: Number(maxDownloadAttemptsInput?.value || 3),
    uploadConcurrency: Number(uploadConcurrencyInput?.value || DEFAULT_UPLOAD_CONCURRENCY),
    uploadTimeoutMs: Number(uploadTimeoutInput?.value || 60000),
    maxUploadAttempts: Number(maxUploadAttemptsInput?.value || 3),
    generateHtmlSaveAs: Boolean(generateHtmlSaveAsInput?.checked),
    includeRewriteReportInHtml: Boolean(includeRewriteReportInput?.checked),
    runtimeResolverEnabled: Boolean(runtimeResolverEnabledInput?.checked),
    apiReplayEnabled: Boolean(apiReplayEnabledInput?.checked),
    apiReplayMaxBodyKb: Number(apiReplayMaxBodyInput?.value || 2048),
    apiReplayCaptureSameOriginOnly: Boolean(apiReplaySameOriginInput?.checked),
    apiReplayAllowTextPlain: Boolean(apiReplayTextPlainInput?.checked),
    pipelineContinueOnPartialFailure: Boolean(pipelineContinuePartialInput?.checked),
    pipelineAutoPrepare3d: Boolean(pipelineAutoPrepare3dInput?.checked),
    pipelineAutoGenerateHtml: Boolean(pipelineAutoGenerateHtmlInput?.checked),
    pipelinePollIntervalMs: Number(pipelinePollIntervalInput?.value || 1000),
    assetServingMode: assetServingModeInput?.value as AssetServingMode,
    corsProxyEnabled: Boolean(corsProxyEnabledInput?.checked),
    corsProxyEndpoint: corsProxyEndpointInput?.value.trim() ?? "",
    moduleServingStrategy: moduleServingStrategyInput?.value as ModuleServingStrategy,
    selfContainedMaxInlineAssetKb: Number(selfContainedMaxInlineInput?.value || 2048),
    allowGenerateWithCriticalMissingAssets: Boolean(allowCriticalMissingInput?.checked)
  });

  if (saveStatus) {
    saveStatus.textContent = "Salvo.";
  }
}
