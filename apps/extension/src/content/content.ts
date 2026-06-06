const MAIN_WORLD_EVENT_TYPE = "CLONE3D_MAIN_EVENT";

injectMainWorldScript();
notifyBackground("clone3d:contentReady", {
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

  notifyBackground("clone3d:mainWorldEvent", data.payload);
});

function injectMainWorldScript(): void {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected-main.js");
  script.async = false;
  script.onload = () => script.remove();
  (document.documentElement || document.head || document.body).appendChild(script);
}

function notifyBackground(type: string, payload: unknown): void {
  chrome.runtime.sendMessage({ type, payload }).catch(() => {
    // The background service worker may still be starting during document_start.
  });
}
