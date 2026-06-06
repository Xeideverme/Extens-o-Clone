import { SettingsStore } from "../shared/settings-store";

const form = document.querySelector<HTMLFormElement>("#settings-form");
const endpointInput = document.querySelector<HTMLInputElement>("#worker-endpoint");
const publicBaseInput = document.querySelector<HTMLInputElement>("#public-base-url");
const thresholdInput = document.querySelector<HTMLInputElement>("#inline-threshold");
const downloadConcurrencyInput = document.querySelector<HTMLInputElement>("#download-concurrency");
const downloadTimeoutInput = document.querySelector<HTMLInputElement>("#download-timeout");
const maxDownloadAttemptsInput = document.querySelector<HTMLInputElement>("#max-download-attempts");
const saveStatus = document.querySelector<HTMLParagraphElement>("#save-status");
const settingsStore = new SettingsStore();

void loadSettings();

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void saveSettings();
});

async function loadSettings(): Promise<void> {
  const settings = await settingsStore.get();

  if (endpointInput) {
    endpointInput.value = settings.workerEndpoint;
  }

  if (publicBaseInput) {
    publicBaseInput.value = settings.publicBaseUrl;
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
}

async function saveSettings(): Promise<void> {
  await settingsStore.set({
    workerEndpoint: endpointInput?.value.trim() ?? "",
    publicBaseUrl: publicBaseInput?.value.trim() ?? "",
    inlineThresholdKb: Number(thresholdInput?.value || 50),
    downloadConcurrency: Number(downloadConcurrencyInput?.value || 4),
    downloadTimeoutMs: Number(downloadTimeoutInput?.value || 30000),
    maxDownloadAttempts: Number(maxDownloadAttemptsInput?.value || 3)
  });

  if (saveStatus) {
    saveStatus.textContent = "Salvo.";
  }
}
