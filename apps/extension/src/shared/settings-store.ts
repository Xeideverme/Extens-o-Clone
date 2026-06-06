import {
  DEFAULT_DOWNLOAD_CONCURRENCY,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_INLINE_THRESHOLD_BYTES,
  DEFAULT_MAX_DOWNLOAD_ATTEMPTS
} from "@clone3d/shared";
import type { CaptureMode } from "@clone3d/shared";

export interface ExtensionSettings {
  workerEndpoint: string;
  publicBaseUrl: string;
  inlineThresholdKb: number;
  defaultCaptureMode: CaptureMode;
  downloadConcurrency: number;
  downloadTimeoutMs: number;
  maxDownloadAttempts: number;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  workerEndpoint: "",
  publicBaseUrl: "",
  inlineThresholdKb: DEFAULT_INLINE_THRESHOLD_BYTES / 1024,
  defaultCaptureMode: "network",
  downloadConcurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
  downloadTimeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
  maxDownloadAttempts: DEFAULT_MAX_DOWNLOAD_ATTEMPTS
};

export class SettingsStore {
  async get(): Promise<ExtensionSettings> {
    const values = await chrome.storage.local.get({ ...DEFAULT_SETTINGS });

    return {
      workerEndpoint: String(values.workerEndpoint ?? DEFAULT_SETTINGS.workerEndpoint),
      publicBaseUrl: String(values.publicBaseUrl ?? DEFAULT_SETTINGS.publicBaseUrl),
      inlineThresholdKb: Number(values.inlineThresholdKb ?? DEFAULT_SETTINGS.inlineThresholdKb),
      defaultCaptureMode: normalizeCaptureMode(values.defaultCaptureMode),
      downloadConcurrency: normalizePositiveInteger(values.downloadConcurrency, DEFAULT_SETTINGS.downloadConcurrency),
      downloadTimeoutMs: normalizePositiveInteger(values.downloadTimeoutMs, DEFAULT_SETTINGS.downloadTimeoutMs),
      maxDownloadAttempts: normalizePositiveInteger(values.maxDownloadAttempts, DEFAULT_SETTINGS.maxDownloadAttempts)
    };
  }

  async set(settings: Partial<ExtensionSettings>): Promise<void> {
    await chrome.storage.local.set(settings);
  }
}

function normalizeCaptureMode(value: unknown): CaptureMode {
  if (
    value === "basic" ||
    value === "network" ||
    value === "3d" ||
    value === "api-replay" ||
    value === "deep"
  ) {
    return value;
  }

  return DEFAULT_SETTINGS.defaultCaptureMode;
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}
