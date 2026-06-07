import { EXTENSION_MESSAGE_TYPES, MAIN_WORLD_EVENT_TYPE } from "@clone3d/shared";
import type {
  AssetSource,
  ContentCaptureRequest,
  ContentCaptureResult,
  CurrentHtmlSnapshotResponse,
  ExtensionMessage,
  MainWorldEvent
} from "@clone3d/shared";
import { createAssetDiscovery, mergeDiscoveries } from "./asset-discovery";
import { scanDomAssets } from "./dom-scanner";
import { scanPerformanceAssets } from "./performance-scanner";
import { SettingsStore } from "../shared/settings-store";

const mainWorldEvents: MainWorldEvent[] = [];
const settingsStore = new SettingsStore();

chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
  if (message.type === EXTENSION_MESSAGE_TYPES.getCurrentHtmlSnapshot) {
    sendResponse({
      ok: true,
      snapshot: captureHtmlSnapshot()
    });
    return false;
  }

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
void postApiReplaySettings();
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
  if (payload.kind === "api-response") {
    notifyBackground(EXTENSION_MESSAGE_TYPES.apiSnapshotCaptured, {
      method: "GET",
      url: payload.url,
      normalizedUrl: payload.normalizedUrl,
      pageUrl: payload.pageUrl,
      frameUrl: payload.frameUrl || location.href,
      status: payload.status,
      contentType: payload.contentType,
      bodyText: payload.bodyText,
      size: payload.size,
      source: payload.transport === "xhr" ? "xhr-hook" : "fetch-hook",
      capturedAt: payload.capturedAt || payload.createdAt
    });
    return;
  }

  if (payload.kind === "api-response-skipped") {
    notifyBackground(EXTENSION_MESSAGE_TYPES.apiSnapshotSkipped, {
      method: payload.method,
      url: payload.url,
      normalizedUrl: payload.normalizedUrl,
      pageUrl: payload.pageUrl,
      frameUrl: payload.frameUrl || location.href,
      contentType: payload.contentType,
      size: payload.size,
      skippedReason: payload.skippedReason || "skipped",
      source: payload.transport === "xhr" ? "xhr-hook" : "fetch-hook",
      capturedAt: payload.capturedAt || payload.createdAt
    });
    return;
  }

  mainWorldEvents.push(payload);
  trimMainWorldEvents();
  notifyBackground(EXTENSION_MESSAGE_TYPES.mainWorldEvent, payload);
});

function injectMainWorldScript(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected-main.js");
  script.async = false;
  script.onload = () => {
    script.remove();
    void postApiReplaySettings();
  };
  appendScript(script);
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (
    changes.apiReplayEnabled ||
    changes.apiReplayMaxBodyKb ||
    changes.apiReplayCaptureSameOriginOnly ||
    changes.apiReplayAllowTextPlain
  ) {
    void postApiReplaySettings();
  }
});

function notifyBackground(type: string, payload: unknown): void {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // The background service worker may still be starting during document_start.
  });
}

async function postApiReplaySettings(): Promise<void> {
  try {
    const settings = await settingsStore.get();
    window.postMessage(
      {
        type: "CLONE3D_API_REPLAY_SETTINGS",
        payload: {
          apiReplayEnabled: settings.apiReplayEnabled,
          apiReplayMaxBodyKb: settings.apiReplayMaxBodyKb,
          apiReplayCaptureSameOriginOnly: settings.apiReplayCaptureSameOriginOnly,
          apiReplayAllowTextPlain: settings.apiReplayAllowTextPlain
        }
      },
      "*"
    );
  } catch {
    window.postMessage(
      {
        type: "CLONE3D_API_REPLAY_SETTINGS",
        payload: {
          apiReplayEnabled: true,
          apiReplayMaxBodyKb: 2048,
          apiReplayCaptureSameOriginOnly: false,
          apiReplayAllowTextPlain: true
        }
      },
      "*"
    );
  }
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
    htmlSnapshot: captureHtmlSnapshot(),
    capturedAt: Date.now()
  };
}

function captureHtmlSnapshot(): CurrentHtmlSnapshotResponse {
  return {
    html: document.documentElement.outerHTML,
    doctype: serializeDoctype(document.doctype),
    documentUrl: location.href,
    baseUrl: document.baseURI || location.href,
    title: document.title || undefined,
    capturedAt: Date.now()
  };
}

function serializeDoctype(doctype: DocumentType | null): string {
  if (!doctype) {
    return "<!doctype html>";
  }

  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId ? `${doctype.publicId ? "" : " SYSTEM"} "${doctype.systemId}"` : "";
  return `<!doctype ${doctype.name}${publicId}${systemId}>`;
}

function mainWorldEventToAsset(event: MainWorldEvent) {
  if (!event.url || event.kind === "api-response" || event.kind === "api-response-skipped") {
    return [];
  }

  const source: AssetSource =
    event.kind === "fetch"
      ? "fetch-hook"
      : event.kind === "xhr-open"
        ? "xhr-hook"
        : event.kind === "worker"
          ? "worker-hook"
          : event.kind === "wasm-streaming"
            ? "script"
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
