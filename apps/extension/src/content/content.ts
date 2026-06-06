import { EXTENSION_MESSAGE_TYPES, MAIN_WORLD_EVENT_TYPE } from "@clone3d/shared";
import type {
  AssetSource,
  ContentCaptureRequest,
  ContentCaptureResult,
  ExtensionMessage,
  MainWorldEvent
} from "@clone3d/shared";
import { createAssetDiscovery, mergeDiscoveries } from "./asset-discovery";
import { scanDomAssets } from "./dom-scanner";
import { scanPerformanceAssets } from "./performance-scanner";

const mainWorldEvents: MainWorldEvent[] = [];

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type !== EXTENSION_MESSAGE_TYPES.contentCaptureRequest) {
    return false;
  }

  const payload = message.payload as ContentCaptureRequest;
  const result = capturePage(payload);

  sendResponse({
    type: EXTENSION_MESSAGE_TYPES.contentCaptureResult,
    payload: result
  });

  return false;
});

injectMainWorldScript();
notifyBackground(EXTENSION_MESSAGE_TYPES.contentReady, {
  pageUrl: location.href,
  createdAt: Date.now()
});

window.addEventListener("message", (event: MessageEvent) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data as { type?: string; payload?: unknown } | null;
  if (!data || data.type !== MAIN_WORLD_EVENT_TYPE) {
    return;
  }

  const payload = data.payload as MainWorldEvent;
  mainWorldEvents.push(payload);
  trimMainWorldEvents();
  notifyBackground(EXTENSION_MESSAGE_TYPES.mainWorldEvent, payload);
});

function injectMainWorldScript(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected-main.js");
  script.async = false;
  script.onload = () => script.remove();
  appendScript(script);
}

function notifyBackground(type: string, payload: unknown): void {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // The background service worker may still be starting during document_start.
  });
}

function capturePage(request: ContentCaptureRequest): ContentCaptureResult {
  const assets = mergeDiscoveries([
    ...scanDomAssets(),
    ...scanPerformanceAssets(),
    ...mainWorldEvents.flatMap((event) => mainWorldEventToAsset(event))
  ]);

  return {
    jobId: request.jobId,
    pageUrl: location.href,
    pageTitle: document.title || undefined,
    frameUrl: location.href,
    assets,
    mainWorldEvents: [...mainWorldEvents],
    capturedAt: Date.now()
  };
}

function mainWorldEventToAsset(event: MainWorldEvent) {
  if (!event.url) {
    return [];
  }

  const source: AssetSource =
    event.kind === "fetch"
      ? "fetch-hook"
      : event.kind === "xhr-open"
        ? "xhr-hook"
        : event.kind === "worker"
          ? "worker-hook"
          : "image-hook";

  const discovery = createAssetDiscovery({
    rawUrl: event.url,
    source,
    baseUrl: event.pageUrl,
    element: event.kind,
    attribute: "url"
  });

  return discovery ? [{ ...discovery, discoveredAt: event.createdAt }] : [];
}

function trimMainWorldEvents(): void {
  const maxEvents = 500;
  if (mainWorldEvents.length > maxEvents) {
    mainWorldEvents.splice(0, mainWorldEvents.length - maxEvents);
  }
}

function appendScript(script: HTMLScriptElement): void {
  const parent = document.documentElement || document.head || document.body;
  if (parent) {
    parent.appendChild(script);
    return;
  }

  document.addEventListener(
    "readystatechange",
    () => {
      (document.documentElement || document.head || document.body)?.appendChild(script);
    },
    { once: true }
  );
}
