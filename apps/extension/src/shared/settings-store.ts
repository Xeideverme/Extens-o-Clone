import {
  DEFAULT_CATBOX_UPLOAD_ENDPOINT,
  DEFAULT_DOWNLOAD_CONCURRENCY,
  DEFAULT_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_INLINE_THRESHOLD_BYTES,
  DEFAULT_MAX_DOWNLOAD_ATTEMPTS,
  DEFAULT_MAX_UPLOAD_ATTEMPTS,
  DEFAULT_UPLOAD_CONCURRENCY,
  DEFAULT_UPLOAD_TIMEOUT_MS
} from "@clone3d/shared";
import type { CaptureMode } from "@clone3d/shared";

export interface ExtensionSettings {
  catboxUploadEndpoint: string;
  inlineThresholdKb: number;
  defaultCaptureMode: CaptureMode;
  downloadConcurrency: number;
  downloadTimeoutMs: number;
  maxDownloadAttempts: number;
  uploadConcurrency: number;
  uploadTimeoutMs: number;
  maxUploadAttempts: number;
  generateHtmlSaveAs: boolean;
  includeRewriteReportInHtml: boolean;
  runtimeResolverEnabled: boolean;
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  catboxUploadEndpoint: DEFAULT_CATBOX_UPLOAD_ENDPOINT,
  inlineThresholdKb: DEFAULT_INLINE_THRESHOLD_BYTES / 1024,
  defaultCaptureMode: "network",
  downloadConcurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
  downloadTimeoutMs: DEFAULT_DOWNLOAD_TIMEOUT_MS,
  maxDownloadAttempts: DEFAULT_MAX_DOWNLOAD_ATTEMPTS,
  uploadConcurrency: DEFAULT_UPLOAD_CONCURRENCY,
  uploadTimeoutMs: DEFAULT_UPLOAD_TIMEOUT_MS,
  maxUploadAttempts: DEFAULT_MAX_UPLOAD_ATTEMPTS,
  generateHtmlSaveAs: true,
  includeRewriteReportInHtml: true,
  runtimeResolverEnabled: true
};

export class SettingsStore {
  async get(): Promise<ExtensionSettings> {
    const values = await chrome.storage.local.get({ ...DEFAULT_SETTINGS });

    return {
      catboxUploadEndpoint: normalizeEndpoint(values.catboxUploadEndpoint, DEFAULT_SETTINGS.catboxUploadEndpoint),
      inlineThresholdKb: Number(values.inlineThresholdKb ?? DEFAULT_SETTINGS.inlineThresholdKb),
      defaultCaptureMode: normalizeCaptureMode(values.defaultCaptureMode),
      downloadConcurrency: normalizePositiveInteger(values.downloadConcurrency, DEFAULT_SETTINGS.downloadConcurrency),
      downloadTimeoutMs: normalizePositiveInteger(values.downloadTimeoutMs, DEFAULT_SETTINGS.downloadTimeoutMs),
      maxDownloadAttempts: normalizePositiveInteger(values.maxDownloadAttempts, DEFAULT_SETTINGS.maxDownloadAttempts),
      uploadConcurrency: normalizePositiveInteger(values.uploadConcurrency, DEFAULT_SETTINGS.uploadConcurrency),
      uploadTimeoutMs: normalizePositiveInteger(values.uploadTimeoutMs, DEFAULT_SETTINGS.uploadTimeoutMs),
      maxUploadAttempts: normalizePositiveInteger(values.maxUploadAttempts, DEFAULT_SETTINGS.maxUploadAttempts),
      generateHtmlSaveAs: normalizeBoolean(values.generateHtmlSaveAs, DEFAULT_SETTINGS.generateHtmlSaveAs),
      includeRewriteReportInHtml: normalizeBoolean(
        values.includeRewriteReportInHtml,
        DEFAULT_SETTINGS.includeRewriteReportInHtml
      ),
      runtimeResolverEnabled: normalizeBoolean(values.runtimeResolverEnabled, DEFAULT_SETTINGS.runtimeResolverEnabled)
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

function normalizeEndpoint(value: unknown, fallback: string): string {
  const endpoint = String(value ?? "").trim();
  return endpoint || fallback;
}

function normalizeBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}
