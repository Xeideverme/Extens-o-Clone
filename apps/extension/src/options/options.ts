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
}

async function saveSettings(): Promise<void> {
  await settingsStore.set({
    catboxUploadEndpoint: catboxUploadEndpointInput?.value.trim() ?? "",
    inlineThresholdKb: Number(thresholdInput?.value || 50),
    downloadConcurrency: Number(downloadConcurrencyInput?.value || 4),
    downloadTimeoutMs: Number(downloadTimeoutInput?.value || 30000),
    maxDownloadAttempts: Number(maxDownloadAttemptsInput?.value || 3),
    uploadConcurrency: Number(uploadConcurrencyInput?.value || 24),
    uploadTimeoutMs: Number(uploadTimeoutInput?.value || 60000),
    maxUploadAttempts: Number(maxUploadAttemptsInput?.value || 3),
    generateHtmlSaveAs: Boolean(generateHtmlSaveAsInput?.checked),
    includeRewriteReportInHtml: Boolean(includeRewriteReportInput?.checked),
    runtimeResolverEnabled: Boolean(runtimeResolverEnabledInput?.checked)
  });

  if (saveStatus) {
    saveStatus.textContent = "Salvo.";
  }
}
