import type { ExtensionMessage } from "@clone3d/shared";
import { createMessageRouter } from "./message-router";

const routeMessage = createMessageRouter();

chrome.runtime.onInstalled.addListener(() => {
  void chrome.storage.local.set({
    clone3dInstalledAt: Date.now()
  });
});

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  routeMessage(message, sender)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : "unknown_error"
      });
    });

  return true;
});
